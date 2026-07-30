/**
 * Smoke test réel FedaPay sandbox — script manuel, hors suite automatisée.
 *
 * Vérifie que les clés sandbox fournies fonctionnent réellement (création de
 * transaction + push USSD), avec le numéro de test sandbox officiel FedaPay
 * (Bénin, 66000001 — toujours approuvé automatiquement en sandbox).
 *
 * Usage : npx ts-node src/scripts/smoke-fedapay.ts
 * Ne fait pas partie de `npm test` : appelle le réseau FedaPay pour de vrai.
 */
import 'dotenv/config';
import { createTransaction, triggerDirectPayment, getTransactionStatus } from '../services/fedapay';

async function main() {
  console.log('=== Smoke test FedaPay sandbox ===');
  console.log('Environnement :', process.env.FEDAPAY_ENVIRONMENT);

  const requestedAmount = 1000;
  const tx: any = await createTransaction({
    amount: requestedAmount,
    description: 'ConstructCare — smoke test sandbox',
    customerName: 'Client Sandbox',
    customerPhone: '66000001', // numéro de test sandbox FedaPay (Bénin, toujours approuvé)
    provider: 'togocel',
  });
  console.log('Transaction créée :', { id: tx.id, status: tx.status, amount: tx.amount });

  const push: any = await triggerDirectPayment(tx.id, 'togocel');
  const intentAmount = push?.payment_intent?.amount;
  console.log('Push USSD déclenché — payment_intent :', { id: push?.payment_intent?.id, amount: intentAmount, status: push?.payment_intent?.status });

  if (intentAmount !== undefined && intentAmount !== requestedAmount) {
    console.warn(
      `⚠️  ÉCART : montant demandé ${requestedAmount} FCFA, montant du payment_intent ${intentAmount} FCFA ` +
        `(${(((intentAmount - requestedAmount) / requestedAmount) * 100).toFixed(2)} %). ` +
        'Voir Docs/QA/2026-07-30_paiement-mobile-money-fedapay.md — point ouvert à clarifier avec le support FedaPay avant la mise en production.'
    );
  }

  const status: any = await getTransactionStatus(tx.id);
  console.log('Transaction complète après approbation :', JSON.stringify(status, null, 2));

  console.log('=== Terminé : les clés sandbox fonctionnent, transaction créée et poussée côté FedaPay ===');
}

main().catch((e) => {
  console.error('=== ÉCHEC ===', e.message || e);
  process.exit(1);
});
