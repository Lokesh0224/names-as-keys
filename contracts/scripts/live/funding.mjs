import { formatEther } from 'ethers';
import { need } from './context.mjs';
import { checkGasLimit } from './gas.mjs';
export async function quoteFunding(ctx,gasLimit,address=ctx.owner) {
  const fees=await ctx.provider.getFeeData();
  const tip=(fees.maxPriorityFeePerGas??1n)>100000000n?100000000n:(fees.maxPriorityFeePerGas??1n);
  const base=BigInt((await ctx.provider.send('eth_getBlockByNumber',['latest',false])).baseFeePerGas);
  const maxFeePerGas=base*2n+tip,reserveWei=ctx.reserveWei??1000000000000000n;
  return {maxFeePerGas,maxPriorityFeePerGas:tip,reserveWei,requiredWei:gasLimit*maxFeePerGas+reserveWei,
    balanceWei:await ctx.provider.getBalance(address)};
}
export function fundingSummary(funding) {
  return 'requiredETH='+formatEther(funding.requiredWei)+' currentBalanceETH='+formatEther(funding.balanceWei)+
    ' reserveETH='+formatEther(funding.reserveWei)+' selectedMaxFeePerGasWei='+funding.maxFeePerGas+' selectedPriorityFeePerGasWei='+funding.maxPriorityFeePerGas+' requiredWei='+funding.requiredWei+' currentBalanceWei='+funding.balanceWei;
}
export function checkFunding(step,funding) {
  const detail=step+' funding refusal: '+fundingSummary(funding);
  need(funding.maxFeePerGas>0n&&funding.maxFeePerGas<=2000000000n&&funding.maxPriorityFeePerGas<=100000000n&&funding.maxPriorityFeePerGas<=funding.maxFeePerGas,detail+'; failed unchanged fee ceilings');
  need(funding.balanceWei>=funding.requiredWei,detail+'; failed balance >= gasLimit*maxFeePerGas + reserve');
}
export function checkGasAndFunding(step,estimate,funding) {
  try{checkGasLimit(step,estimate);}catch(error){if(error.safe)error.message+='; '+fundingSummary(funding);throw error;}
  checkFunding(step,funding);
}
