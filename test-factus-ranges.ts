import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function run() {
  const config = await prisma.configuracionNegocio.findFirst();
  if (!config) {
    console.error('No config found');
    return;
  }

  const clientId = config.factusClientId;
  const clientSecret = config.factusClientSecret;
  if (!clientId || !clientSecret) {
    console.error('No factus credentials found');
    return;
  }

  const baseUrl = config.factusEntorno === 'PRODUCCION' ? 'https://api.factus.com.co' : 'https://api-sandbox.factus.com.co';

  // 1. Get Token
  console.log('Getting token...');
  let token = '';
  try {
    const res = await axios.post(`${baseUrl}/oauth/token`, {
      grant_type: 'password',
      client_id: clientId,
      client_secret: clientSecret,
      username: config.factusEmail,
      password: config.factusPassword
    });
    token = res.data.access_token;
    console.log('Got token:', token.substring(0, 20) + '...');
  } catch (err: any) {
    console.error('Error getting token:', err?.response?.data || err.message);
    return;
  }

  // 2. Fetch /v2/numbering-ranges
  console.log('\nFetching GET /v2/numbering-ranges...');
  try {
    const res = await axios.get(`${baseUrl}/v2/numbering-ranges`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('/v2/numbering-ranges returned:', JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.error('Error GET /v2/numbering-ranges:', err?.response?.data || err.message);
  }

  // 3. Fetch /v2/numbering-ranges/dian
  console.log('\nFetching GET /v2/numbering-ranges/dian...');
  try {
    const res = await axios.get(`${baseUrl}/v2/numbering-ranges/dian`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('/v2/numbering-ranges/dian returned:', JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.error('Error GET /v2/numbering-ranges/dian:', err?.response?.data || err.message);
  }
}

run().catch(console.error).finally(() => prisma.$disconnect());
