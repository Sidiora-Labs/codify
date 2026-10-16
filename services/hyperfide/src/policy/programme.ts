import type { Component, ComponentContext } from '../components/registry.js';

export type ServiceRole = 'control' | 'provisioner' | 'dispatch';
export interface ProgrammePolicy {
  schema_version: 1;
  programme_id: string;
  repository: string;
  spec_revision: string;
  policy_revision: number;
  status: 'ACTIVE';
  approval: { decision: 'APPROVED'; record_id: string; spec_revision: string; policy_revision: number };
  allowed_roles: readonly ServiceRole[];
  allowed_actions: readonly string[];
}
export class FoundationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'FoundationError'; }
}
export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function fields(value: Record<string, unknown>, expected: string[], label: string): void {
  if (Object.keys(value).some(key => !expected.includes(key)) || expected.some(key => !(key in value)))
    throw new FoundationError('POLICY_INVALID', label + ' fields must match schema version 1');
}
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
export function validatePolicy(value: unknown, expectedRevision: string, role: ServiceRole): ProgrammePolicy {
  if (!object(value)) throw new FoundationError('POLICY_INVALID', 'Policy must be an object');
  fields(value, ['schema_version','programme_id','repository','spec_revision','policy_revision','status','approval','allowed_roles','allowed_actions'], 'Policy');
  if (value.schema_version !== 1 || !nonempty(value.programme_id) || !nonempty(value.repository) ||
      !nonempty(value.spec_revision) || !Number.isSafeInteger(value.policy_revision) || (value.policy_revision as number) < 1)
    throw new FoundationError('POLICY_INVALID', 'Invalid policy version or identities');
  if (value.status !== 'ACTIVE') throw new FoundationError('PROGRAMME_INACTIVE', 'Programme is not active');
  if (!object(value.approval)) throw new FoundationError('APPROVAL_REQUIRED', 'Explicit approval record required');
  fields(value.approval, ['decision','record_id','spec_revision','policy_revision'], 'Approval');
  if (value.approval.decision !== 'APPROVED' || !nonempty(value.approval.record_id))
    throw new FoundationError('APPROVAL_REQUIRED', 'Explicit programme-owner approval required');
  if (value.spec_revision !== expectedRevision || value.approval.spec_revision !== value.spec_revision ||
      value.approval.policy_revision !== value.policy_revision)
    throw new FoundationError('REVISION_MISMATCH', 'Approval, policy and pinned specification revisions must agree');
  const roles = value.allowed_roles;
  const actions = value.allowed_actions;
  if (!Array.isArray(roles) || roles.length === 0 || new Set(roles).size !== roles.length ||
      roles.some(item => !['control','provisioner','dispatch'].includes(item)) ||
      !Array.isArray(actions) || actions.length === 0 || new Set(actions).size !== actions.length ||
      actions.some(item => typeof item !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(item)))
    throw new FoundationError('POLICY_INVALID', 'Explicit unique roles and actions required');
  const policy = Object.freeze({ ...value, approval: Object.freeze({ ...value.approval }),
    allowed_roles: Object.freeze([...roles]), allowed_actions: Object.freeze([...actions]) }) as unknown as ProgrammePolicy;
  const bootAction = { control: 'programme.activate', provisioner: 'programme.provision', dispatch: 'programme.dispatch' }[role];
  assertAdmission(policy, role, bootAction);
  return policy;
}
export function assertAdmission(policy: ProgrammePolicy, role: ServiceRole, action: string): void {
  if (!policy.allowed_roles.includes(role)) throw new FoundationError('ROLE_DENIED', 'Service role is not approved');
  if (!policy.allowed_actions.includes(action)) throw new FoundationError('ACTION_DENIED', 'Action is not approved');
}
// The file is trusted startup configuration, not a signed approval system or a durable activation transition.
export function createComponent(_context: ComponentContext): Component {
  return { apiVersion: 1, actions: {
    'programme.authorize': async (input, context) => {
      if (!object(input) || Object.keys(input).sort().join(',') !== 'action,policy_revision,spec_revision' ||
          typeof input.action !== 'string') throw new FoundationError('INVALID_REQUEST', 'Authorization input needs action and pinned revisions');
      if (input.spec_revision !== context.policy.spec_revision || input.policy_revision !== context.policy.policy_revision)
        throw new FoundationError('REVISION_MISMATCH', 'Requested revisions differ from trusted startup configuration');
      assertAdmission(context.policy, context.role, input.action);
      return { authorized: true, programme_id: context.policy.programme_id, role: context.role,
        action: input.action, spec_revision: context.policy.spec_revision, policy_revision: context.policy.policy_revision };
    }
  }};
}
