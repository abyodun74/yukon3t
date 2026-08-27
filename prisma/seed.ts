import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: "admin@yukon3t.local" },
    create: {
      email: "admin@yukon3t.local",
      name: "YuKon3t Admin",
      emailVerified: new Date(),
      isAdmin: true,
      country: "Global",
      interests: ["Trust & Safety"],
      trustScore: 100,
      trustBand: "TRUSTED",
    },
    update: {},
  });

  const circles = [
    {
      name: "World Travelers",
      category: ["Travel"],
      description: "Trade tips, meet up, and plan cross-border trips together.",
    },
    {
      name: "Language Exchange Corner",
      category: ["Culture"],
      description: "Practice a new language with native speakers, platonically.",
    },
    {
      name: "Remote Builders",
      category: ["Professional"],
      description: "Indie hackers and remote workers collaborating across time zones.",
    },
  ];

  for (const c of circles) {
    const slug = c.name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-");
    await prisma.circle.upsert({
      where: { slug },
      create: {
        ...c,
        slug,
        createdById: admin.id,
        members: { create: { userId: admin.id, role: "OWNER" } },
      },
      update: {},
    });
  }

  console.log("Seed complete. Admin:", admin.email);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
