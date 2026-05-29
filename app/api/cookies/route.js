import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const sessionPath = path.join(process.cwd(), 'session.json');
    if (fs.existsSync(sessionPath)) {
      const data = fs.readFileSync(sessionPath, 'utf8');
      const cookies = JSON.parse(data);
      return NextResponse.json({ success: true, cookies });
    }
    return NextResponse.json({ success: true, cookies: [] });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
