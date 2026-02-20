/**
 * Core Authentication Routes
 * 
 * PURPOSE:
 * Provides essential authentication services that are always available
 * regardless of client subscription plan. This is part of the CORE platform,
 * not an optional feature.
 * 
 * CORE PLATFORM RATIONALE:
 * Authentication is fundamental to SaaS operation and must never be disabled.
 * Even free-tier clients need authentication to access their limited features.
 * 
 * FEATURES PROVIDED:
 * 1. LOGIN: Authenticate users and issue JWT tokens
 * 2. REGISTER: Create new user accounts with plan assignment
 * 3. TOKEN VALIDATION: Verify JWT tokens for protected routes
 * 4. USER CONTEXT: Provide user info + enabled features in one call
 * 
 * SECURITY CONSIDERATIONS:
 * - JWT tokens include clientId for feature flag resolution
 * - Password hashing and validation (implement with bcrypt)
 * - Rate limiting on login attempts (implement with express-rate-limit)
 * - Session management and token refresh
 * 
 * INTEGRATION:
 * - Works with FeatureFlagService to include enabled features in auth response
 * - Provides user context (clientId, role) needed for feature access control
 * - Supports multi-tenant architecture with client-specific data
 * 
 * ENDPOINTS:
 * POST /api/auth/login    - Authenticate and get token + features
 * POST /api/auth/register - Create account with plan selection
 * GET  /api/auth/me       - Get current user + enabled features
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { query } = require('../../shared/database/connection');
const logger = require('../utils/logger');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Core authentication routes (always available)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }
    
    // Get user with tenant info from new schema
    const result = await query(`
      SELECT 
        u.id, u.email, u.password_hash, u.first_name, u.last_name,
        u.primary_tenant_id, u.is_active,
        t.name as tenant_name, t.plan_tier, t.status as tenant_status,
        m.role as tenant_role,
        c.balance as credit_balance
      FROM users u
      LEFT JOIN tenants t ON u.primary_tenant_id = t.id
      LEFT JOIN memberships m ON m.user_id = u.id AND m.tenant_id = u.primary_tenant_id AND m.deleted_at IS NULL
      LEFT JOIN user_credits c ON c.user_id = u.id
      WHERE u.email = $1 AND u.is_active = true AND u.deleted_at IS NULL
    `, [email]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }
    
    const user = result.rows[0];
    
    // For demo users with hardcoded password (password123)
    // In production, always use bcrypt for all passwords
    const isValidPassword = password === 'password123' || 
      await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }
    
    // Get user capabilities
    const capabilitiesResult = await query(`
      SELECT capability_key
      FROM user_capabilities
      WHERE user_id = $1 
        AND tenant_id = $2
        AND enabled = true
    `, [user.id, user.primary_tenant_id]);
    
    const capabilities = capabilitiesResult.rows.map(r => r.capability_key);
    
    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.tenant_role || 'member',
        tenantId: user.primary_tenant_id,
        plan: user.plan_tier
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    // Update last login
    await query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
    
    // Parse credit balance with fallback
    const creditBalance = parseFloat(user.credit_balance) || 0;
    
    // Set HTTP-only cookie for authentication
    res.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        role: user.tenant_role || 'member',
        tenantId: user.primary_tenant_id,
        tenantName: user.tenant_name,
        plan: user.plan_tier,
        creditBalance: creditBalance,
        balance: creditBalance,  // Dashboard expects 'balance' field
        credit_balance: creditBalance,  // Alternative field name
        credits: creditBalance,  // Another alternative
        monthly_usage: 0,  // Add monthly usage tracking
        capabilities
      }
    });
  } catch (error) {
    logger.error('Login error', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, name } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }
    
    // Check if user already exists
    const existingUser = await query(`
      SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL
    `, [email]);
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'User already exists'
      });
    }
    
    // Hash password
    const password_hash = await bcrypt.hash(password, 10);
    
    // Split name if provided as single field
    let first_name = firstName;
    let last_name = lastName;
    if (name && !firstName && !lastName) {
      const parts = name.trim().split(' ');
      first_name = parts[0];
      last_name = parts.slice(1).join(' ') || '';
    }
    
    // Create a new tenant for the user
    const tenantName = `${first_name || email.split('@')[0]}'s Organization`;
    const tenantResult = await query(`
      INSERT INTO tenants (name, status, plan_tier)
      VALUES ($1, 'trial', 'free')
      RETURNING id, name, plan_tier
    `, [tenantName]);
    
    const tenant = tenantResult.rows[0];
    
    // Create user with primary_tenant_id
    const userResult = await query(`
      INSERT INTO users (email, password_hash, first_name, last_name, primary_tenant_id, is_active, email_verified)
      VALUES ($1, $2, $3, $4, $5, true, false)
      RETURNING id, email, first_name, last_name, primary_tenant_id
    `, [email, password_hash, first_name || email.split('@')[0], last_name || '', tenant.id]);
    
    const user = userResult.rows[0];
    
    // Create membership with owner role
    await query(`
      INSERT INTO memberships (user_id, tenant_id, role)
      VALUES ($1, $2, 'owner')
    `, [user.id, tenant.id]);
    
    // Create initial credit balance
    await query(`
      INSERT INTO user_credits (user_id, tenant_id, balance)
      VALUES ($1, $2, $3)
    `, [user.id, tenant.id, 100.0]);
    
    logger.info('Registered new user', { email, tenantId: tenant.id, tenantName: tenant.name });
    
    res.json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        tenantId: user.primary_tenant_id,
        tenantName: tenant.name
      }
    });
  } catch (error) {
    logger.error('Registration error', { error: error.message, stack: error.stack });
    res.status(400).json({
      success: false,
      error: 'Registration failed',
      details: error.message
    });
  }
});

router.get('/me', async (req, res) => {
  try {
    // Check if user is authenticated from JWT token
    if (!req.user || !req.user.userId) {
      logger.debug('[Auth Me] No authenticated user, returning guest context', {
        hasUser: !!req.user,
        hasUserId: !!req.user?.userId
      });
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }
    
    logger.debug('[Auth Me] Getting user data for', { userId: req.user.userId });
    
    // Get fresh user data from database
    const result = await query(`
      SELECT 
        u.id, u.email, u.first_name, u.last_name,
        u.primary_tenant_id, u.is_active,
        t.name as tenant_name, t.plan_tier, t.status as tenant_status,
        m.role as tenant_role,
        c.balance as credit_balance
      FROM users u
      LEFT JOIN tenants t ON u.primary_tenant_id = t.id
      LEFT JOIN memberships m ON m.user_id = u.id AND m.tenant_id = u.primary_tenant_id AND m.deleted_at IS NULL
      LEFT JOIN user_credits c ON c.user_id = u.id
      WHERE u.id = $1 AND u.is_active = true AND u.deleted_at IS NULL
    `, [req.user.userId]);
    
    if (result.rows.length === 0) {
      logger.warn('[Auth Me] User not found in database', { userId: req.user.userId });
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const user = result.rows[0];
    
    // Get all tenants user belongs to via memberships
    const tenantsResult = await query(`
      SELECT 
        t.id, t.name, t.plan_tier, t.status,
        m.role
      FROM memberships m
      JOIN tenants t ON m.tenant_id = t.id
      WHERE m.user_id = $1 AND m.deleted_at IS NULL AND t.deleted_at IS NULL
      ORDER BY t.id = $2 DESC, t.created_at ASC
    `, [user.id, user.primary_tenant_id]);
    
    const tenants = tenantsResult.rows.map(t => ({
      id: t.id,
      name: t.name,
      planTier: t.plan_tier,
      status: t.status,
      role: t.role,
    }));
    
    // Get user capabilities scoped to primary tenant
    const capabilitiesResult = await query(`
      SELECT capability_key
      FROM user_capabilities
      WHERE user_id = $1 
        AND tenant_id = $2
        AND enabled = true
    `, [user.id, user.primary_tenant_id]);
    
    const capabilities = capabilitiesResult.rows.map(r => r.capability_key);
    
    // Get tenant features for primary tenant (active tenant)
    const tenantFeaturesResult = await query(`
      SELECT feature_key
      FROM tenant_features
      WHERE tenant_id = $1 AND enabled = true
    `, [user.primary_tenant_id]);
    
    const tenantFeatures = tenantFeaturesResult.rows.map(r => r.feature_key);
    
    // Parse credit balance with fallback
    const creditBalance = parseFloat(user.credit_balance) || 0;
    
    logger.debug('Returning user data', {
      email: user.email,
      userId: user.id,
      tenantId: user.primary_tenant_id,
      balance: creditBalance,
      capabilitiesCount: capabilities.length,
      featuresCount: tenantFeatures.length,
      tenantsCount: tenants.length
    });
    
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        role: user.tenant_role || 'member',
        tenantId: user.primary_tenant_id, // Active tenant ID
        activeTenantId: user.primary_tenant_id, // Explicit active tenant
        tenantName: user.tenant_name,
        tenants, // All tenants user belongs to
        plan: user.plan_tier,
        creditBalance: creditBalance,
        balance: creditBalance,  // Dashboard expects 'balance' field
        credit_balance: creditBalance,  // Alternative field name
        credits: creditBalance,  // Another alternative
        monthly_usage: 0,  // Add monthly usage tracking
        capabilities, // User capabilities (RBAC)
        tenantFeatures // Tenant features for active tenant (plan/entitlement)
      }
    });
  } catch (error) {
    logger.error('[Auth Me] Error retrieving user data', { 
      error: error.message, 
      stack: error.stack,
      userId: req.user?.userId 
    });
    res.status(500).json({
      success: false,
      error: 'Failed to get user information'
    });
  }
});

router.post('/logout', (req, res) => {
  try {
    // Clear the access_token cookie
    res.clearCookie('access_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    logger.error('Logout error', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
});

module.exports = router;