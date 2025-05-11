/*
  Warnings:

  - You are about to drop the column `updatedAt` on the `current_weather` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "current_weather" DROP COLUMN "updatedAt";

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
