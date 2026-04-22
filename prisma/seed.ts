import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("Seeding database…")

  // Create default tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: "default" },
    update: {},
    create: {
      name: "WGU — Default",
      slug: "default",
    },
  })
  console.log(`Tenant: ${tenant.name} (${tenant.id})`)

  // You can add more tenants here, e.g. per college:
  // const chp = await prisma.tenant.upsert({
  //   where: { slug: "chp" },
  //   update: {},
  //   create: { name: "College of Health Professions", slug: "chp" },
  // })

  console.log("Seed complete.")
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
