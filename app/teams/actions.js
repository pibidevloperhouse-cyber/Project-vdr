"use server";

import { db } from "@/db/index.js";
import { companies, users, groups, userGroups } from "@/db/schema.js";
import { eq, inArray, and, desc } from "drizzle-orm";

export async function fetchCompany(companyId) {
  try {
    const data = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId));
    return { data: data[0] || null, error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
}

export async function fetchUsers(companyId) {
  try {
    const data = await db.select().from(users).where(eq(users.companyId, companyId));
    // map to snake_case to match supabase response
    const mappedData = data.map(u => ({
      ...u,
      company_id: u.companyId,
      password_hash: u.passwordHash,
      last_login_at: u.lastLoginAt,
      created_at: u.createdAt,
      updated_at: u.updatedAt,
      phone_number: u.phoneNumber,
      company_name: u.companyName,
      two_fa_enabled: u.twoFaEnabled,
      nda_status: u.ndaStatus,
      nda_accepted_at: u.ndaAcceptedAt,
      request_status: u.requestStatus,
      workspace_id: u.workspaceId,
      nda_signature_path: u.ndaSignaturePath,
      nda_signature_url: u.ndaSignatureUrl,
      nda_signature_type: u.ndaSignatureType,
      nda_ip_address: u.ndaIpAddress,
      nda_user_id: u.ndaUserId
    }));
    return { data: mappedData, error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
}

export async function fetchGroups(companyId, workspaceId) {
  try {
    const data = await db.select().from(groups).where(and(eq(groups.companyId, companyId), eq(groups.workspaceId, workspaceId))).orderBy(desc(groups.createdAt));
    const mappedData = data.map(g => ({
      ...g,
      company_id: g.companyId,
      created_by: g.createdBy,
      created_at: g.createdAt,
      updated_at: g.updatedAt,
      workspace_id: g.workspaceId
    }));
    return { data: mappedData, error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
}

export async function fetchUserGroups(userIds) {
  try {
    if (!userIds || userIds.length === 0) return { data: [], error: null };
    const data = await db.select({ user_id: userGroups.userId, group_id: userGroups.groupId }).from(userGroups).where(inArray(userGroups.userId, userIds));
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
}

export async function fetchUserGroupsByUserId(userId) {
  try {
    const data = await db.select({ user_id: userGroups.userId, group_id: userGroups.groupId }).from(userGroups).where(eq(userGroups.userId, userId));
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
}

export async function fetchAllUserGroups() {
  try {
    const data = await db.select({ user_id: userGroups.userId, group_id: userGroups.groupId }).from(userGroups);
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
}

export async function fetchUsersMinimal(companyId) {
  try {
    const data = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.companyId, companyId));
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
}

export async function updateUserStatus(userId, status) {
  try {
    const data = await db
      .update(users)
      .set({ status })
      .where(eq(users.id, userId))
      .returning();

    return {
      data: data[0] || null,
      error: null
    };
  } catch (error) {
    console.error("updateUserStatus error:", error);

    return {
      data: null,
      error: error instanceof Error
        ? error.message
        : String(error)
    };
  }
}
