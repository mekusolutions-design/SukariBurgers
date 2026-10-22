/**
 * One-shot: set InventoryProjection.available_stock + total_value from usable batches.
 *
 *   npx ts-node scripts/reconcile-available-from-batches.ts
 *   SHOP_ID=1 APPLY=1 npx ts-node scripts/reconcile-available-from-batches.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const shopId = process.env.SHOP_ID || '1';
const apply = process.env.APPLY === '1';

function shopLocalDayStart(now: Date): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const day = fmt.format(now);
  return new Date(`${day}T00:00:00.000+03:00`);
}

async function main() {
  const todayStart = shopLocalDayStart(new Date());
  const projections = await prisma.inventoryProjection.findMany({
    where: { shop_id: shopId },
    include: { item: { select: { name: true, unit: true } } },
  });

  console.log(`Shop ${shopId} | items=${projections.length} | apply=${apply}`);
  console.log('item_id\tname\tstored_qty\tbatch_qty\tdelta\tstored_value\tbatch_value');

  let fixed = 0;
  for (const row of projections) {
    const batches = await prisma.inventoryBatch.findMany({
      where: {
        shop_id: shopId,
        item_id: row.item_id,
        qty_remaining: { gt: 0 },
        OR: [{ expiry_date: null }, { expiry_date: { gte: todayStart } }],
      },
      select: { qty_remaining: true, unit_cost: true },
    });
    let batchQty = 0;
    let batchValue = 0;
    for (const b of batches) {
      const q = Math.max(0, Number(b.qty_remaining));
      batchQty += q;
      batchValue += q * Number(b.unit_cost ?? 0);
    }
    const stored = Number(row.available_stock ?? 0);
    const storedVal = Number(row.total_value ?? 0);
    const delta = batchQty - stored;
    if (Math.abs(delta) > 1e-6 || Math.abs(batchValue - storedVal) > 0.01) {
      console.log(
        `${row.item_id}\t${row.item?.name ?? ''}\t${stored}\t${batchQty}\t${delta}\t${storedVal}\t${batchValue}`,
      );
      if (apply) {
        await prisma.inventoryProjection.update({
          where: {
            shop_id_item_id: { shop_id: shopId, item_id: row.item_id },
          },
          data: {
            available_stock: batchQty,
            total_value: Math.max(0, batchValue),
          },
        });
        fixed += 1;
      }
    }
  }
  console.log(apply ? `Updated ${fixed} projection rows.` : 'Dry-run only. Set APPLY=1 to write.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
