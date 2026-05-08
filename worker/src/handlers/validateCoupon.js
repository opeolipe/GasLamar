import { jsonResponse } from '../cors.js';
import { clientIp } from '../utils.js';
import { checkRateLimitKV, rateLimitResponse } from '../rateLimit.js';
import { TIER_PRICES } from '../constants.js';
import { validateCoupon } from '../mayar.js';

const VALID_TIERS = new Set(['coba', 'single', '3pack', 'jobhunt']);

export async function handleValidateCoupon(request, env) {
  const ip = clientIp(request);

  // 10 attempts per minute per IP — prevents coupon enumeration attacks
  const rl = await checkRateLimitKV(env, ip, 10, 60, 'coupon_validate');
  if (!rl.allowed) return rateLimitResponse(request, env, rl.retryAfter ?? 60);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ valid: false, message: 'Request tidak valid' }, 400, request, env);
  }

  const { coupon_code: rawCode, tier, email: rawEmail } = body;

  if (!rawCode || typeof rawCode !== 'string') {
    return jsonResponse({ valid: false, message: 'Kode promo diperlukan' }, 400, request, env);
  }

  const couponCode = rawCode.trim().toUpperCase();
  if (couponCode.length < 3 || couponCode.length > 64) {
    return jsonResponse({ valid: false, message: 'Kode promo tidak valid' }, 400, request, env);
  }

  const tierConfig = TIER_PRICES[tier];
  if (!VALID_TIERS.has(tier) || !tierConfig) {
    return jsonResponse({ valid: false, message: 'Pilih paket terlebih dahulu' }, 400, request, env);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const customerEmail = (rawEmail && typeof rawEmail === 'string' && emailRegex.test(rawEmail) && rawEmail.length <= 254)
    ? rawEmail.toLowerCase().trim()
    : undefined;

  try {
    const result = await validateCoupon(env, couponCode, tierConfig.amount, customerEmail);

    const couponData = result?.data?.coupon ?? result?.data ?? result?.coupon;
    const isValid = result?.data?.valid === true || result?.statusCode === 200;

    if (!isValid) {
      const msg = result?.messages?.[0] || result?.message || 'Kode promo tidak valid atau sudah habis';
      return jsonResponse({ valid: false, message: msg }, 200, request, env);
    }

    const discountType  = couponData?.discountType  ?? couponData?.discount_type  ?? 'percentage';
    const discountValue = couponData?.discountValue ?? couponData?.discount_value ?? couponData?.value ?? 0;

    let discountedAmount = tierConfig.amount;
    if (discountType === 'percentage') {
      discountedAmount = Math.max(0, Math.round(tierConfig.amount * (1 - discountValue / 100)));
    } else if (discountType === 'monetary') {
      discountedAmount = Math.max(0, tierConfig.amount - discountValue);
    }

    return jsonResponse({
      valid:             true,
      coupon_code:       couponCode,
      discount_type:     discountType,
      discount_value:    discountValue,
      original_amount:   tierConfig.amount,
      discounted_amount: discountedAmount,
    }, 200, request, env);

  } catch (err) {
    console.error(JSON.stringify({ event: 'coupon_validate_error', error: err.message, couponCode }));
    // Don't expose internal errors — surface as invalid
    return jsonResponse({ valid: false, message: 'Kode promo tidak valid atau sudah habis' }, 200, request, env);
  }
}
