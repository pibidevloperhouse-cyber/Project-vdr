"use client";

import React, { useState, useEffect } from 'react';
import OrganizationModal from '@/components/business-owner/OrganizationModal';
import {
  FaSearch,
  FaEdit,
  FaTrash,
  FaBuilding,
  FaCheckCircle,
  FaExclamationTriangle,
} from 'react-icons/fa';

export default function BusinessOwnerOrganizationsPage() {
  const [organizations, setOrganizations] = useState([]);
  const [plans, setPlans] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPlan, setFilterPlan] = useState('ALL');

  const [filterStatus, setFilterStatus] = useState('ALL');

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState(null);

  const fetchOrganizations = async () => {
    try {
      const [orgsRes, plansRes] = await Promise.all([
        fetch('/api/business-owner/organizations'),
        fetch('/api/business-owner/plans'),
      ]);

      if (orgsRes.ok) {
        const data = await orgsRes.json();
        setOrganizations(data.organizations || []);
      }
      if (plansRes.ok) {
        const pData = await plansRes.json();
        setPlans(pData.plans || []);
      }
    } catch (err) {
      console.error('Error loading organizations:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrganizations();
  }, []);

  const handleOpenAdd = () => {
    setSelectedOrg(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (org) => {
    setSelectedOrg(org);
    setModalOpen(true);
  };

  const handleDelete = async (org) => {
    if (!window.confirm(`Are you sure you want to delete organization "${org.name}"?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/business-owner/organizations?id=${org.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = await res.json();
        setOrganizations(data.organizations || []);
      }
    } catch (err) {
      console.error('Failed to delete org:', err);
    }
  };

  const handleSaveOrganization = async (payload) => {
    const isEdit = Boolean(payload.id);
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch('/api/business-owner/organizations', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save organization');
    }

    await fetchOrganizations();
  };

  const filteredOrgs = organizations.filter((o) => {
    const matchesSearch =
      (o.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (o.adminEmail || '').toLowerCase().includes(search.toLowerCase());
    const matchesPlan = filterPlan === 'ALL' || o.plan === filterPlan;
    const orgStatus = String(o.status || 'pending').toLowerCase().trim();
    const matchesStatus = filterStatus === 'ALL' || orgStatus === filterStatus.toLowerCase();
    return matchesSearch && matchesPlan && matchesStatus;
  });

  const getStatusBadge = (status) => {
    const s = String(status || '').toLowerCase().trim();
    switch (s) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Active
          </span>
        );
      case 'suspended':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            Suspended
          </span>
        );
      case 'pending':
      case 'trial':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Pending
          </span>
        );
    }
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 fade-in duration-700">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            Tenant Organizations
          </h1>
          <p className="text-slate-500 mt-2 text-[15px]">
            Manage enterprise companies, subscription quotas, and account status across all VDR tenants.
          </p>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-white/80 backdrop-blur-xl border border-slate-200/80 rounded-2xl p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-80">
          <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400 text-sm">
            <FaSearch />
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or admin email..."
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[var(--brand)]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Status:
            </span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 focus:outline-none focus:border-[var(--brand)]"
            >
              <option value="ALL">All Statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Plan:
            </span>
            <select
              value={filterPlan}
              onChange={(e) => setFilterPlan(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 focus:outline-none focus:border-[var(--brand)]"
            >
              <option value="ALL">All Plans</option>
              <option value="Free">Free Tier</option>
              <option value="Pro">Pro Tier</option>
              <option value="Enterprise">Enterprise</option>
              <option value="Standard VDR">Standard VDR</option>
            </select>
          </div>
        </div>
      </div>

      {/* Organizations Table Card */}
      <div className="bg-white/80 backdrop-blur-xl border border-slate-200/80 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[12.5px] font-bold uppercase tracking-wider text-slate-500">
                <th className="py-4 px-6">Company / Organization</th>
                <th className="py-4 px-6">Admin Contact</th>
                <th className="py-4 px-6">Seats</th>
                <th className="py-4 px-6">Plan Tier</th>
                <th className="py-4 px-6">Status</th>
                <th className="py-4 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    Loading organizations...
                  </td>
                </tr>
              ) : filteredOrgs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    No organizations match your search or filter.
                  </td>
                </tr>
              ) : (
                filteredOrgs.map((org) => (
                  <tr
                    key={org.id}
                    className="hover:bg-slate-50/60 transition-colors"
                  >
                    <td className="py-4 px-6 font-semibold text-slate-900">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-brand-soft flex items-center justify-center text-[var(--brand)] shrink-0">
                          <FaBuilding className="text-sm" />
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{org.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-slate-600 font-medium">
                      {org.adminEmail}
                    </td>
                    <td className="py-4 px-6 text-slate-700 font-semibold">
                      {org.usersCount} Users
                    </td>
                    <td className="py-4 px-6">
                      <span className="inline-block px-3 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold">
                        {org.plan}
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      {getStatusBadge(org.status)}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleOpenEdit(org)}
                          className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-[var(--brand)] transition-colors"
                          title="Edit organization"
                        >
                          <FaEdit className="text-sm" />
                        </button>
                        <button
                          onClick={() => handleDelete(org)}
                          className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-rose-600 transition-colors"
                          title="Delete organization"
                        >
                          <FaTrash className="text-sm" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Organization Create/Edit Modal */}
      <OrganizationModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSaveOrganization}
        initialData={selectedOrg}
        plans={plans}
      />
    </div>
  );
}
