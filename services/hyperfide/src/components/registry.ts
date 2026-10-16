import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FoundationError, object, assertAdmission } from '../policy/programme.js';
import type { ProgrammePolicy, ServiceRole } from '../policy/programme.js';
import type {InvocationContext} from '../transport/protocol.js';
import {assertInvocation} from '../transport/protocol.js';
import {createResourceContainer} from '../storage/runtime.js';
import type {ResourceContainer,ServiceResources} from '../storage/runtime.js';

export interface StartupContext {
  readonly role: ServiceRole;
  readonly policy: ProgrammePolicy;
  readonly signal: AbortSignal;
  readonly env: Readonly<NodeJS.ProcessEnv>;
}
export interface CapabilityResolver {
  require<T>(component:string,capability:string,validate:(value:unknown)=>value is T):T;
}
export interface ComponentContext extends StartupContext {
  readonly invocation?:InvocationContext;
  readonly resources:ServiceResources;
  readonly dependencies:CapabilityResolver;
}
export type Action = (input: unknown, context: ComponentContext) => unknown | Promise<unknown>;
export interface Component { apiVersion: 1; actions: Record<string, Action>; capabilities?:Readonly<Record<string,unknown>>; close?: () => void | Promise<void> }
interface Fragment {
  schema_version: 1; id: string; task: string; roles: ServiceRole[]; module: string;
  entry: string; api_version: 1; actions: string[]; requires: string[];
}
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const actionName = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
function invalid(message: string): never { throw new FoundationError('REGISTRY_INVALID', message); }
function uniqueStrings(value: unknown, regex: RegExp, nonempty: boolean): value is string[] {
  return Array.isArray(value) && (!nonempty || value.length > 0) &&
    value.every(item => typeof item === 'string' && regex.test(item)) && new Set(value).size === value.length;
}
function fragment(value: unknown): Fragment {
  const keys = ['schema_version','id','task','roles','module','entry','api_version','actions','requires'];
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value)))
    invalid('Component fields must match version 1');
  if (value.schema_version !== 1 || value.api_version !== 1 || typeof value.id !== 'string' ||
      !identifier.test(value.id) || value.id === 'system' || typeof value.task !== 'string' ||
      !/^\d+\.\d+$/.test(value.task) || typeof value.module !== 'string' || typeof value.entry !== 'string' ||
      !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value.entry) || !uniqueStrings(value.actions, actionName, true) ||
      !uniqueStrings(value.requires, identifier, false) || !uniqueStrings(value.roles, /^(control|provisioner|dispatch)$/, true))
    invalid('Invalid component identity, version, roles or actions');
  return value as unknown as Fragment;
}
async function jsonFile(filename: string): Promise<unknown> {
  const info = await fs.stat(filename);
  if (!info.isFile() || info.size > 1024 * 1024) invalid('Registration must be a bounded regular file');
  try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch { return invalid('Invalid registration JSON'); }
}
export class ComponentRegistry {
  private readonly instances = new Map<string, Component>();
  private readonly declarations = new Map<string, Fragment>();
  private readonly disposers = new Map<string, () => void | Promise<void>>();
  private order: string[] = [];
  private closed = false;
  private readonly contexts=new Map<string,ComponentContext>();
  private readonly resources:ResourceContainer;
  private readonly resourceView:ServiceResources;
  constructor(private readonly context: StartupContext) {
    this.resources=createResourceContainer(context);
    this.resourceView=Object.freeze({
      gateway:Object.freeze(this.resources.gateway) as typeof this.resources.gateway,
      observe:this.resources.observe.bind(this.resources),
      withReplicaConnection:this.resources.withReplicaConnection.bind(this.resources),
      withMigrationConnection:this.resources.withMigrationConnection.bind(this.resources),
      withListener:this.resources.withListener.bind(this.resources),
      describe:this.resources.describe.bind(this.resources),
      close:this.resources.close.bind(this.resources)
    });
  }
  resolveCapability<T>(id:string,capability:string,validate:(value:unknown)=>value is T):T {
    if(this.closed)invalid('Registry is closed');
    const instance=this.instances.get(id);
    if(!instance?.capabilities||!Object.hasOwn(instance.capabilities,capability)||!validate(instance.capabilities[capability]))
      invalid('Required initialized dependency capability is unavailable');
    return instance.capabilities[capability] as T;
  }
  async load(directory: string, moduleRoot: string): Promise<void> {
    const root = await fs.realpath(moduleRoot);
    const registrationRoot = await fs.realpath(directory);
    const entries = await fs.readdir(registrationRoot, { withFileTypes: true });
    const modules = new Map<string, string>();
    const actionOwners = new Set<string>();
    for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
      if (!entry.name.endsWith('.json') || entry.name === 'schema.json') continue;
      if (!entry.isFile() || entry.isSymbolicLink()) invalid('Registration must not be a symlink or directory');
      const declaration = fragment(await jsonFile(path.join(registrationRoot, entry.name)));
      if (this.declarations.has(declaration.id)) invalid('Duplicate component ID');
      for (const action of declaration.actions) {
        if (action === 'system.describe' || actionOwners.has(action)) invalid('Duplicate or reserved action');
        actionOwners.add(action);
      }
      if (path.isAbsolute(declaration.module) || declaration.module.includes('\\') ||
          declaration.module.split('/').some(part => part === '..' || part === '.' || part === '') ||
          !declaration.module.endsWith('.js')) invalid('Unsafe component module path');
      let filename: string;
      try { filename = await fs.realpath(path.resolve(root, declaration.module)); }
      catch { invalid('Missing linked component module'); }
      const relative = path.relative(root, filename);
      if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative) ||
          !(await fs.stat(filename)).isFile()) invalid('Linked module escapes module root or is not a regular file');
      this.declarations.set(declaration.id, declaration);
      modules.set(declaration.id, filename);
    }
    if (!this.declarations.size) invalid('No registered components');
    const visited = new Set<string>(), visiting = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) invalid('Component dependency cycle');
      visiting.add(id);
      const declaration = this.declarations.get(id)!;
      for (const dependency of declaration.requires) {
        const target = this.declarations.get(dependency);
        if (!target) invalid('Missing component dependency');
        if (declaration.roles.some(role => !target.roles.includes(role))) invalid('Dependency lacks required service role');
        visit(dependency);
      }
      visiting.delete(id); visited.add(id); this.order.push(id);
    };
    for (const id of this.declarations.keys()) visit(id);
    // All schemas, paths, and dependency checks finish before any module can execute.
    try {
      for (const id of this.order) {
        if (this.closed || this.context.signal.aborted) throw new Error('Component startup was cancelled');
        const declaration = this.declarations.get(id)!;
        if (!declaration.roles.includes(this.context.role)) continue;
        const exports = await import(pathToFileURL(modules.get(id)!).href) as Record<string, unknown>;
        if (this.closed || this.context.signal.aborted) throw new Error('Component import was cancelled');
        const factory = exports[declaration.entry];
        if (typeof factory !== 'function') throw new Error('Missing component factory export');
        const dependencies:CapabilityResolver=Object.freeze({require:<T>(dependency:string,capability:string,validate:(value:unknown)=>value is T):T=>{
          if(!declaration.requires.includes(dependency))invalid('Component requested an undeclared dependency');
          return this.resolveCapability(dependency,capability,validate);
        }});
        const componentContext:ComponentContext=Object.freeze({...this.context,resources:this.resourceView,dependencies});
        this.contexts.set(id,componentContext);
        const value: unknown = await factory(componentContext);
        if (this.closed || this.context.signal.aborted) {
          if (object(value) && typeof value.close === 'function') await value.close();
          throw new Error('Component startup was cancelled');
        }
        if (object(value) && typeof value.close === 'function') this.disposers.set(id, value.close.bind(value) as () => void | Promise<void>);
        if (!object(value) || value.apiVersion !== 1 || !object(value.actions) ||
            (value.close !== undefined && typeof value.close !== 'function')) throw new Error('Invalid component factory result');
        const names = Object.keys(value.actions);
        if (names.length !== declaration.actions.length || declaration.actions.some(name => !names.includes(name)) ||
            names.some(name => typeof (value.actions as Record<string, unknown>)[name] !== 'function'))
          throw new Error('Factory actions differ from declared operations');
        if(value.capabilities!==undefined&&(!object(value.capabilities)||
            Object.keys(value.capabilities).some(name=>!/^[A-Za-z][A-Za-z0-9._\/-]{0,127}$/.test(name))))throw new Error('Invalid component capabilities');
        const capabilities=Object.freeze({...value.capabilities as Record<string,unknown>|undefined});
        const actions = Object.freeze({ ...value.actions }) as Record<string, Action>;
        this.instances.set(id, Object.freeze({ apiVersion: 1, actions,capabilities }));
      }
    } catch (error) {
      await this.close();
      throw new FoundationError('COMPONENT_LOAD_FAILED', 'Linked component import or factory failed: ' + (error instanceof Error ? error.message : 'unknown error'));
    }
  }
  describe(): unknown {
    return { role: this.context.role, interface_version: 1, components: this.order
      .filter(id => this.instances.has(id)).map(id => ({ id, actions: [...this.declarations.get(id)!.actions] })) };
  }
  hasComponent(id:string):boolean{return this.instances.has(id);}
  private invocationAuthorizer:((invocation:InvocationContext)=>Promise<void>)|undefined;
  installInvocationAuthorizer(authorize:(invocation:InvocationContext)=>Promise<void>):void {
    if(this.invocationAuthorizer)invalid("Invocation authorizer already installed");
    this.invocationAuthorizer=authorize;
  }
  async invoke(id: string, action: string, input: unknown, invocation?:InvocationContext): Promise<unknown> {
    if (this.closed) throw new FoundationError('HANDLER_FAILED', 'Registry is closed');
    const component = this.instances.get(id);
    if (!component) throw new FoundationError('UNKNOWN_COMPONENT', 'Component is unavailable in this service role');
    if (!Object.hasOwn(component.actions, action)) throw new FoundationError('UNKNOWN_ACTION', 'Unknown component action');
    assertAdmission(this.context.policy, this.context.role, action);
    if(this.instances.has("14.1")) {
      if(!invocation||!this.invocationAuthorizer)throw new FoundationError("AUTH_REQUIRED","Authenticated invocation required");
      assertInvocation(invocation);
      if(invocation.payload.component!==id||invocation.payload.action!==action||invocation.payload.input!==input)
        throw new FoundationError("AUTH_SCOPE_DENIED","Invocation dispatch binding mismatch");
      await this.invocationAuthorizer(invocation);
    }
    const context=this.contexts.get(id)!;
    return component.actions[action]!(input, invocation?Object.freeze({...context,invocation}):context);
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const failures: unknown[] = [];
    for (const id of [...this.order].reverse()) {
      const dispose = this.disposers.get(id);
      if (dispose) try { await dispose(); } catch (error) { failures.push(error); }
    }
    try{await this.resources.close();}catch(error){failures.push(error);}
    if (failures.length) throw new FoundationError('HANDLER_FAILED', 'One or more component cleanup operations failed');
  }
}
