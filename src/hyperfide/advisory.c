/* Task 21.4 native advisory component: describe and resolve only; authority is always NONE. */
#include "advisory.h"
#include <ctype.h>
#include <string.h>

static const char *const hf_advisory_purposes[]={"guard","readiness","triage","memory","recap",NULL};
static const char *const hf_advisory_phases[]={"submit","result",NULL};

static int hf_advisory_known(const char *const *list,const char *value){
    for(size_t i=0;list[i];i++)if(!strcmp(list[i],value))return 1;
    return 0;
}

int hf_advisory_action_name(const char *purpose,const char *phase,char *out,size_t size){
    if(!purpose||!phase||!out||!hf_advisory_known(hf_advisory_purposes,purpose)||!hf_advisory_known(hf_advisory_phases,phase))return 0;
    int n=snprintf(out,size,"decision.legacy.%s.%s",purpose,phase);
    return n>0&&(size_t)n<size;
}

static const char *hf_advisory_ws(const char *p){while(isspace((unsigned char)*p))p++;return p;}

/* Strict flat object of short unescaped ASCII string values; the dispatcher already validated JSON. */
static int hf_advisory_fields(const char *json,const char *const *names,char values[][32],size_t count){
    unsigned seen=0;const char *p=hf_advisory_ws(json);
    if(*p++!='{')return 0;
    p=hf_advisory_ws(p);
    if(*p=='}')return count==0&&!*hf_advisory_ws(p+1);
    for(;;){
        char key[32],value[32];size_t n=0;
        if(*p++!='"')return 0;
        while(*p&&*p!='"'){if(*p=='\\'||(unsigned char)*p<32||(unsigned char)*p>126||n+1>=sizeof key)return 0;key[n++]=*p++;}
        if(*p++!='"')return 0;
        key[n]='\0';
        p=hf_advisory_ws(p);if(*p++!=':')return 0;p=hf_advisory_ws(p);
        if(*p++!='"')return 0;
        n=0;
        while(*p&&*p!='"'){if(*p=='\\'||(unsigned char)*p<32||(unsigned char)*p>126||n+1>=sizeof value)return 0;value[n++]=*p++;}
        if(*p++!='"')return 0;
        value[n]='\0';
        size_t index=count;
        for(size_t i=0;i<count;i++)if(!strcmp(names[i],key))index=i;
        if(index==count||(seen&(1U<<index)))return 0;
        seen|=1U<<index;memcpy(values[index],value,n+1);
        p=hf_advisory_ws(p);
        if(*p=='}')break;
        if(*p++!=',')return 0;
        p=hf_advisory_ws(p);
    }
    return seen==(1U<<count)-1U&&!*hf_advisory_ws(p+1);
}

static int hf_advisory_error(FILE *output,const char *code,const char *message){
    fprintf(output,"{\"ok\":false,\"error\":{\"code\":\"%s\",\"message\":\"%s\"},\"authority\":\"NONE\"}\n",code,message);
    return 1;
}

int hf_component_21_4(const char *action,const char *request_json,FILE *output){
    if(!action||!request_json||!output)return 1;
    if(!strcmp(action,"decision.advisory.describe")){
        if(!hf_advisory_fields(request_json,NULL,NULL,0))return hf_advisory_error(output,"INVALID_REQUEST","Describe accepts an empty object");
        fputs("{\"ok\":true,\"component\":\"21.4\",\"authority\":\"NONE\",\"service_component\":\"21.4\",\"legacy_actions\":[",output);
        int first=1;
        for(size_t i=0;hf_advisory_purposes[i];i++)for(size_t j=0;hf_advisory_phases[j];j++){
            fprintf(output,"%s\"decision.legacy.%s.%s\"",first?"":",",hf_advisory_purposes[i],hf_advisory_phases[j]);first=0;
        }
        fprintf(output,"],\"budget_ms\":%d,\"job_deadline_ms\":%d,\"unavailable\":\"ABSTAIN\",\"grants\":{\"leases\":false,\"evidence_waivers\":false,\"protected_publication\":false},"
            "\"audit_fields\":[\"purpose\",\"packet_hash\",\"revisions\",\"rubric_version\",\"model\",\"route\",\"raw_output\",\"interpretation\",\"action\",\"latency_ms\",\"usage\",\"outcomes\"]}\n",
            HF_ADVISORY_BUDGET_MS,HF_ADVISORY_JOB_DEADLINE_MS);
        return 0;
    }
    if(!strcmp(action,"decision.advisory.resolve")){
        static const char *const names[]={"purpose","phase"};char values[2][32];char resolved[64];
        if(!hf_advisory_fields(request_json,names,values,2))return hf_advisory_error(output,"INVALID_REQUEST","Exactly purpose and phase strings are required");
        if(!hf_advisory_action_name(values[0],values[1],resolved,sizeof resolved))return hf_advisory_error(output,"ADVISORY_UNSUPPORTED","Unknown advisory purpose or phase");
        fprintf(output,"{\"ok\":true,\"component\":\"21.4\",\"action\":\"%s\",\"budget_ms\":%d,\"authority\":\"NONE\",\"applied\":false}\n",resolved,HF_ADVISORY_BUDGET_MS);
        return 0;
    }
    return hf_advisory_error(output,"UNKNOWN_ACTION","Unsupported advisory action");
}
