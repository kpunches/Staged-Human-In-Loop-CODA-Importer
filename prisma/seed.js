const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log("Seeding database…")

  const tenant = await prisma.tenant.upsert({
    where: { slug: "default" },
    update: {},
    create: {
      name: "WGU — Default",
      slug: "default",
    },
  })
  console.log(`Tenant: ${tenant.name} (${tenant.id})`)
  console.log("Seed complete.")
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
