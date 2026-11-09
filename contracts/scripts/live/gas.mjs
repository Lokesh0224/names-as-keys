import { GAS_CEILINGS, MAX_TRANSACTION_GAS } from './config.mjs';
import { need } from './context.mjs';
export const isCreateStep=step=>step==='T12'||step==='T14';
export function gasNumbers(step, estimate) {
  const ceiling=GAS_CEILINGS[step]??(step.startsWith('PROOF_')?3000000n:undefined);
  need(ceiling!==undefined,'Unknown step gas policy');
  const estimatedGas=BigInt(estimate),create=isCreateStep(step);
  const paddedGas=(estimatedGas*(create?110n:120n)+99n)/100n;
  const gasLimit=create&&paddedGas>MAX_TRANSACTION_GAS?MAX_TRANSACTION_GAS:paddedGas;
  const bp=estimatedGas>0n?(gasLimit-estimatedGas)*10000n/estimatedGas:0n;
  const headroomPercent=(bp/100n)+'.'+String(bp<0n?-(bp%100n):bp%100n).padStart(2,'0');
  return {step,estimatedGas,gasLimit,ceiling,protocolCap:MAX_TRANSACTION_GAS,headroomPercent};
}
export function checkGasLimit(step, estimate) {
  const result=gasNumbers(step,estimate),{estimatedGas,gasLimit,ceiling}=result;
  const detail=step+' gas refusal: estimatedGas='+estimatedGas+' gasLimit='+gasLimit+' ceiling='+ceiling+' protocolCap='+MAX_TRANSACTION_GAS;
  need(estimatedGas>0n,detail+'; failed positive gas estimate limit');
  need(ceiling<=MAX_TRANSACTION_GAS,detail+'; failed policy ceiling at/below protocol cap');
  if(isCreateStep(step)){
    need(estimatedGas<=MAX_TRANSACTION_GAS,detail+'; failed raw estimate protocol cap');
    need(estimatedGas*105n<=MAX_TRANSACTION_GAS*100n,detail+'; failed minimum 5% headroom (estimate*1.05 <= protocol cap)');
  }else{
    need(gasLimit<=MAX_TRANSACTION_GAS,detail+'; failed per-transaction gas cap');
    need(gasLimit<=ceiling,detail+'; failed per-step gas ceiling (ceil(estimate*120/100) <= ceiling)');
  }
  return result;
}
