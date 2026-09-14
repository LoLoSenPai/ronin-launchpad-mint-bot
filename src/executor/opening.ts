import type { Config } from '../config.js';
import type { Endpoint } from '../ronin.js';
import { BotError, requireThat } from '../util.js';
import { simulateNow } from './prepare.js';

const inFlight=new WeakMap<Endpoint['client'],ReturnType<typeof simulateNow>>();
function boundedSimulation(endpoint:Endpoint,config:Config) {
  const existing=inFlight.get(endpoint.client);
  if(existing)return existing;
  const request=simulateNow(endpoint.client,config).finally(()=>inFlight.delete(endpoint.client));
  inFlight.set(endpoint.client,request);
  return request;
}

// First successful pending-state call wins; a slow secondary cannot delay signing.
export async function openingGate(endpoints:Endpoint[],config:Config) {
  requireThat(endpoints.length>0,'NO_HEALTHY_RPC');
  try {
    return await Promise.any(endpoints.map(async endpoint=>{
      const result=await boundedSimulation(endpoint,config);
      if(result.status!=='success')throw new BotError('STAGE_NOT_STARTED');
      return endpoint;
    }));
  }catch(error) {
    if(error instanceof AggregateError) {
      const errors=error.errors as unknown[];
      if(errors.some(e=>e instanceof BotError && e.code==='STAGE_NOT_STARTED'))return undefined;
      const terminal=errors.find(e=>e instanceof BotError && e.code!=='SIMULATION_FAILED');
      if(terminal)throw terminal;
    }
    throw new BotError('SIMULATION_FAILED');
  }
}
