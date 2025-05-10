/*
  Warnings:

  - You are about to drop the `Location` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WeatherData` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "WeatherData" DROP CONSTRAINT "WeatherData_locationId_fkey";

-- DropTable
DROP TABLE "Location";

-- DropTable
DROP TABLE "WeatherData";

-- CreateTable
CREATE TABLE "locations" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "isTracking" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "current_weather" (
    "locationId" INTEGER NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "windSpeed" DOUBLE PRECISION NOT NULL,
    "humidity" INTEGER NOT NULL,
    "conditionCode" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "current_weather_pkey" PRIMARY KEY ("locationId")
);

-- CreateTable
CREATE TABLE "daily_forecast" (
    "id" SERIAL NOT NULL,
    "locationId" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "maxTemp" DOUBLE PRECISION NOT NULL,
    "minTemp" DOUBLE PRECISION NOT NULL,
    "conditionCode" INTEGER NOT NULL,

    CONSTRAINT "daily_forecast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "locations_name_key" ON "locations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "daily_forecast_locationId_date_key" ON "daily_forecast"("locationId", "date");

-- AddForeignKey
ALTER TABLE "current_weather" ADD CONSTRAINT "current_weather_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_forecast" ADD CONSTRAINT "daily_forecast_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
