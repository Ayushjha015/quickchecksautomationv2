import { NextResponse } from 'next/server';
import { getConfig, saveConfig } from '@/lib/config';

export async function GET() {
  const config = getConfig();
  
  // Return the config, but we can optionally mask passwords if we want
  // However, since it's a personal automation app and they need to see/update it, we return it as is.
  return NextResponse.json({ config });
}

export async function POST(request) {
  try {
    const newConfig = await request.json();
    const updatedConfig = saveConfig(newConfig);
    return NextResponse.json({ success: true, config: updatedConfig });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}
