/*
  Warnings:

  - Added the required column `updatedAt` to the `current_weather` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "current_weather" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
