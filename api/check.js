// Vercel function: GET /api/check?url=example.com (see web/handler.js).
import { handleCheck } from '../web/handler.js';

export function GET(request) {
  return handleCheck(request);
}
