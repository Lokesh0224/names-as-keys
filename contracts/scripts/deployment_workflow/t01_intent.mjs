import { digest } from './workflow.mjs';

// Preserve all fields except these RPC observation fields. In particular the
// snapshot nonces, step sequence, runtime identities and fee policy stay bound.
function fixedReviewContext(context = {}) {
  const { latest, reviewedAtSeconds, observedAtSeconds, ...fixed } = context;
  return fixed;
}

export function t01IntentDigest(bundle, packet) {
  const { plan, observation, ...fixedBundle } = bundle;
  const { observationBlock, observationBlockHash, snapshot, reviewContext, ...fixedPlan } = plan;
  const { number, hash, timestamp, ...fixedSnapshot } = snapshot;
  const { block, blockNumber, blockHash, timestamp: observedTimestamp, observedUTC, reviewContext: observationContext, ...fixedObservation } = observation;
  const { tx, ...fixedPacket } = packet;
  const { gas, maxFeePerGas, ...fixedTransaction } = tx;
  return digest({
    kind: 'T01_INTENT_V1',
    bundle: { ...fixedBundle, plan: { ...fixedPlan, snapshot: fixedSnapshot, reviewContext: fixedReviewContext(reviewContext) },
      observation: { ...fixedObservation, reviewContext: fixedReviewContext(observationContext) } },
    packet: { ...fixedPacket, tx: fixedTransaction },
  });
}

const hash = value => typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value);
export function isT01IntentAuthorization(record) {
  return record?.stage === 'GO' && record.step === 'T01' && record.kind === 'T01_INTENT_V1' &&
    Object.keys(record).length === 4 && hash(record.intentDigest);
}
