import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const counts: any = {};
  counts.user = await p.user.count();
  counts.adminUser = await p.adminUser.count();
  counts.company = await p.company.count();
  counts.businessType = await (p as any).businessType.count();
  counts.plan = await (p as any).plan.count();
  counts.module = await (p as any).module.count();
  counts.businessTypeModule = await (p as any).businessTypeModule.count().catch(() => 'N/A');
  counts.planModulePermission = await (p as any).planModulePermission?.count?.().catch(() => 'N/A') ?? 'no model';
  counts.roleModulePermission = await (p as any).roleModulePermission?.count?.().catch(() => 'N/A') ?? 'no model';
  console.log(JSON.stringify(counts, null, 2));
  await p.$disconnect();
})();
