import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DRIVER_LIST = {
  'Sumon Khan':      { department: 'Management Expense',        id: '150400004' },
  'Md Hanif':        { department: 'Foreign Project Department', id: '160900038' },
  'Mohammad Islam':  { department: 'Project Sales',              id: '171200235' },
  'Md Sabuz Miah':   { department: 'Corporate Sales',            id: '181000333' },
  'Md Masud Rana':   { department: 'Technical Engineering',      id: '230100883' },
  'Shaha Alom':      { department: 'Retail Sales',               id: '240301028' },
  'Shahidul Islam':  { department: 'Human Resource',             id: 'N/A'       },
  'Md. Liton':       { department: 'Administration',             id: '240111115' },
  'Md Liton':        { department: 'Administration',             id: '240111115' },
};

function matchDriver(name) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  for (const [key, val] of Object.entries(DRIVER_LIST)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase().split(' ')[1] ?? '')) {
      return { name: key, ...val };
    }
  }
  return null;
}

async function urlToBase64(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const base64 = Buffer.from(buf).toString('base64');
  const mediaType = res.headers.get('content-type') ?? 'image/jpeg';
  return { base64, mediaType };
}

async function extractFromImage(base64, mediaType) {
  const PROMPT = `You are an AI assistant extracting structured data from AKSID Corporation car fuel bill documents.
The documents may be in English or Bengali. Extract data from:
  1. Fuel receipt -> fuel_cost
  2. Toll receipt -> toll
  3. Food bill / Fund Requisition -> food_bill
  4. Driver Log -> km_start, km_end, vehicle_no, driver_name, date
  5. Car Fuel Bill Summary form -> all columns
  6. Parking receipt -> car_parking
  7. Hotel receipt -> hotel
  8. Police fine -> police_fine
  9. Maintenance/repair -> maintenance

Return ONLY valid JSON:
{
  "bill_type": "FUEL_RECEIPT|TOLL|FOOD_BILL|MAINTENANCE|PARKING|HOTEL|POLICE_FINE|DRIVER_LOG|FUEL_BILL_SUMMARY|UNKNOWN",
  "date": "YYYY-MM-DD or null",
  "driver_name": "string or null",
  "vehicle_no": "string or null",
  "amounts": {
    "fuel_cost": 0,
    "toll": 0,
    "food_bill": 0,
    "maintenance": 0,
    "car_parking": 0,
    "hotel": 0,
    "police_fine": 0,
    "others": 0
  },
  "km": { "start": null, "end": null },
  "confidence": "HIGH|MEDIUM|LOW",
  "notes": ""
}`;

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 800,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: PROMPT },
    ]}],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    return json ? JSON.parse(json) : null;
  } catch { return null; }
}

export async function POST(request) {
  try {
    const secret = request.headers.get('x-webhook-secret');
    if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { image_urls = [], driver_name, date, bill_period_from, bill_period_to, vehicle_no } = body;

    if (!image_urls.length) {
      return NextResponse.json({ error: 'No image_urls provided' }, { status: 400 });
    }

    const extractions = await Promise.all(
      image_urls.map(async (url) => {
        const { base64, mediaType } = await urlToBase64(url);
        return extractFromImage(base64, mediaType);
      })
    );

    const valid = extractions.filter(Boolean);
    const sumAmounts = (field) => valid.reduce((s, d) => s + (d?.amounts?.[field] ?? 0), 0) || null;

    const resolvedDate = date || valid.find((d) => d?.date)?.date || null;
    const resolvedDriverName = driver_name || valid.find((d) => d?.driver_name)?.driver_name || null;
    const resolvedVehicleNo = vehicle_no || valid.find((d) => d?.vehicle_no)?.vehicle_no || null;
    const kmStart = valid.find((d) => d?.km?.start)?.km?.start ?? null;
    const kmEnd = valid.find((d) => d?.km?.end)?.km?.end ?? null;
    const driverInfo = matchDriver(resolvedDriverName);

    const entry = {
      date: resolvedDate,
      driver_name: driverInfo?.name ?? resolvedDriverName,
      department: driverInfo?.department ?? null,
      driver_id: driverInfo?.id ?? null,
      km_start: kmStart,
      km_end: kmEnd,
      total_km: kmStart && kmEnd ? kmEnd - kmStart : null,
      fuel_cost: sumAmounts('fuel_cost'),
      toll: sumAmounts('toll'),
      food_bill: sumAmounts('food_bill'),
      maintenance: sumAmounts('maintenance'),
      car_parking: sumAmounts('car_parking'),
      hotel: sumAmounts('hotel'),
      police_fine: sumAmounts('police_fine'),
      others: sumAmounts('others'),
      vehicle_no: resolvedVehicleNo,
      bill_period_from: bill_period_from ?? null,
      bill_period_to: bill_period_to ?? null,
      submission_timestamp: new Date().toISOString(),
      status: 'Pending Review',
    };

    const undetected = [];
    if (!entry.date) undetected.push('Date');
    if (!entry.driver_name) undetected.push('Driver Name');
    if (!entry.vehicle_no) undetected.push('Vehicle No');
    if (!entry.fuel_cost && !entry.toll && !entry.food_bill && !entry.maintenance && !entry.car_parking && !entry.hotel) {
      undetected.push('Bill amounts');
    }
    if (!driverInfo) undetected.push('Department (driver not in roster)');

    return NextResponse.json({ success: true, entry, raw_extractions: valid, undetected_fields: undetected, needs_review: undetected.length > 0 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
