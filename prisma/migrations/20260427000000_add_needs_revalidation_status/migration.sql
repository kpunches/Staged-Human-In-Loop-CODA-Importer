-- AlterEnum
-- This must run in its own migration: PostgreSQL prohibits ALTER TYPE ... ADD VALUE
-- inside a transaction that also references the new value (see migration 20260427000001).
ALTER TYPE "ReviewStatus" ADD VALUE 'NEEDS_REVALIDATION';
