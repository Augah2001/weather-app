import { NextResponse } from 'next/server';

import { PrismaClient } from '@prisma/client';
// In Next.js 13+, fetch is globally available, no need to import node-fetch
// import fetch from 'node-fetch';

// Instantiate PrismaClient outside the handler function
// to avoid creating new instances on every request in production
const prisma = new PrismaClient();
 // or however you import Prisma

export async function POST(request: Request) {
  const { locationName, message } = await request.json();
  const notif = await prisma.notification.create({
    data: { locationName, message },
  });
  return NextResponse.json(notif, { status: 201 });
}

export async function GET() {
  const all = await prisma.notification.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return NextResponse.json(all);
}
