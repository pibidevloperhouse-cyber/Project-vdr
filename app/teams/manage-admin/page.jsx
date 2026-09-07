"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/utils/supabase/client';
import { fetchCompany, fetchUsers, fetchGroups, fetchUserGroups, updateUserStatus } from '../actions';

export default function ManageAdminPage() {
  const [loading, setLoading] = useState(true);
  const [admins, setAdmins] = useState([]);
  const [groups, setGroups] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [currentCompanyId, setCurrentCompanyId] = useState('');

  // Selection state
  const [selectedAdminIds, setSelectedAdminIds] = useState([]);

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState(null);

  // Custom Context Menu State
  const [contextMenu, setContextMenu] = useState(null); // { x, y, admin }

  // Form states for Add/Edit
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    mobile: '',
    org: '',
    role: 'admin',
    selectedGroups: [] // array of groupIds
  });

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Fetch data on load
  const fetchData = async () => {
    try {
      setLoading(true);
      const rawSession = localStorage.getItem('vdr_session');
      if (!rawSession) return;
      const session = JSON.parse(rawSession);
      const companyId = session.company_id;
      const activeWorkspaceId = session.active_workspace_id;
      setCurrentCompanyId(companyId);

      // Fetch company name from users or a default
      // Fetch company name from company table
      const { data: companyData, error: companyError } = await fetchCompany(companyId);

      if (companyError) throw companyError;

      setCompanyName(companyData.name);

      setFormData(prev => ({
        ...prev,
        org: companyData.name
      }));

      // 1. Fetch all users in the company
      const { data: usersData, error: usersError } = await fetchUsers(companyId);

      if (usersError) throw usersError;

      // 2. Fetch all groups in the active workspace
      const { data: groupsData, error: groupsError } = await fetchGroups(companyId, activeWorkspaceId);

      if (groupsError) throw groupsError;
      setGroups(groupsData || []);

      // 3. Fetch all user_groups to map memberships
      const userIds = (usersData || []).map(u => u.id);
      let memberships = [];
      if (userIds.length > 0) {
        const { data: memData, error: memError } = await fetchUserGroups(userIds);
        if (memError) throw memError;
        memberships = memData || [];
      }

      // Map users with their groups and filter to only include admins in the current workspace
      const mappedAdmins = (usersData || [])
        .filter(u => ['super_admin', 'admin', 'sub_admin'].includes(u.role))
        .map(user => {
          const userGroupIds = memberships
            .filter(m => m.user_id === user.id)
            .map(m => m.group_id);

          const userGroups = (groupsData || [])
            .filter(g => userGroupIds.includes(g.id))
            .map(g => ({ id: g.id, name: g.name }));

          return {
            ...user,
            company_name: companyData.name,
            groups: userGroups
          };
        })
        .filter(user => user.workspace_id === activeWorkspaceId || user.groups.length > 0);

      setAdmins(mappedAdmins);
    } catch (error) {
      console.error('Error fetching admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Global listener to close right-click context menu on left click
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  // Filter admins based on search query
  const filteredAdmins = admins.filter(admin => {
    const query = searchQuery.toLowerCase();
    const nameMatch = admin.name?.toLowerCase().includes(query);
    const emailMatch = admin.email?.toLowerCase().includes(query);
    const mobileMatch = admin.phone_number?.toLowerCase().includes(query);
    const orgMatch = (admin.company_name || companyName)?.toLowerCase().includes(query);
    const groupMatch = admin.groups?.some(g => g.name.toLowerCase().includes(query));

    return nameMatch || emailMatch || mobileMatch || orgMatch || groupMatch;
  });

  // Handle row checkbox selection
  const handleSelectAdmin = (adminId) => {
    setSelectedAdminIds(prev => {
      if (prev.includes(adminId)) {
        return prev.filter(id => id !== adminId);
      } else {
        return [...prev, adminId];
      }
    });
  };

  // Handle master checkbox selection
  const handleSelectAll = () => {
    if (selectedAdminIds.length === filteredAdmins.length) {
      setSelectedAdminIds([]);
    } else {
      setSelectedAdminIds(filteredAdmins.map(a => a.id));
    }
  };

  // Right-Click Context Menu trigger
  const handleContextMenu = (e, admin) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      admin
    });
  };

  // Toggle admin status (Active <-> Inactive)
  const handleToggleStatus = async (admin) => {
    try {
      const newStatus =
        admin.status === "active"
          ? "suspended"
          : "active";

      const { data, error } = await updateUserStatus(
        admin.id,
        newStatus
      );

      if (error) {
        throw new Error(error);
      }

      showToast(
        `Administrator ${newStatus === "active"
          ? "activated"
          : "suspended"
        } successfully.`
      );

      setContextMenu(null);

      await fetchData();

    } catch (error) {
      console.error("Error updating status:", error);

      showToast(
        error.message || "Failed to update administrator status.",
        true
      );
    }
  };

  // Delete admin
  const handleDeleteAdmin = async (adminId) => {
    if (!confirm('Are you sure you want to remove this administrator?')) return;
    try {
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', adminId);

      if (error) throw error;

      showToast('Administrator removed successfully.');
      setSelectedAdminIds(prev => prev.filter(id => id !== adminId));
      fetchData();
    } catch (err) {
      console.error('Error deleting admin:', err);
      showToast('Failed to remove administrator.', true);
    }
  };



  // Export to CSV (Support selection or all)
  const handleExportCSV = () => {
    const adminsToExport = selectedAdminIds.length > 0
      ? admins.filter(a => selectedAdminIds.includes(a.id))
      : filteredAdmins;

    if (adminsToExport.length === 0) {
      showToast('No administrators to export.', true);
      return;
    }

    const headers = ['Name', 'Organization', 'Email', 'Role', 'Mobile', 'Expiry Date', 'Status'];
    const rows = adminsToExport.map(admin => [
      admin.name || '',
      admin.company_name || companyName,
      admin.email || '',
      admin.role ? admin.role.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Admin',
      admin.phone_number || '',
      formatExpiryDate(admin.created_at),
      admin.status === 'active' ? 'Active' : 'Inactive'
    ]);

    const csvContent = "data:text/csv;charset=utf-8,"
      + [headers.join(','), ...rows.map(e => e.map(val => `"${val.replace(/"/g, '""')}"`).join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `VDR_Administrators_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`${adminsToExport.length} administrators exported.`);
  };

  // Resend Invite Action
  const handleResendInvite = () => {
    const selected = admins.filter(a => selectedAdminIds.includes(a.id));
    if (selected.length === 0) {
      showToast('Please select one or more administrators to resend invitations.', true);
      return;
    }

    // Simulate/mock resending invites
    const emails = selected.map(a => a.email).join(', ');
    showToast(`Invitation email successfully resent to: ${emails}`);
    setSelectedAdminIds([]);
  };

  // Toast Helper
  const showToast = (msg, isError = false) => {
    if (isError) {
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(''), 4000);
    } else {
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(''), 4000);
    }
  };

  // Open edit modal
  const openEditModal = (admin) => {
    setSelectedAdmin(admin);
    setFormData({
      name: admin.name || '',
      email: admin.email || '',
      mobile: admin.phone_number || '',
      org: admin.company_name || companyName,
      role: admin.role || 'admin',
      selectedGroups: admin.groups?.map(g => g.id) || []
    });
    setIsEditModalOpen(true);
  };

  // Handle submit Add/Edit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg('');

    try {
      if (isAddModalOpen) {
        // 1. Create a new user in the users table directly
        const { data: newUser, error: userError } = await supabase
          .from('users')
          .insert({
            company_id: currentCompanyId,
            workspace_id: JSON.parse(localStorage.getItem('vdr_session'))?.active_workspace_id,
            company_name: formData.org,
            name: formData.name,
            email: formData.email,
            phone_number: formData.mobile,
            role: formData.role,
            status: 'active',
            // Default temp password hash
            password_hash: '$2a$10$rB3Q92wZ4k1Qh.iP76gqKOpn8r9/xP8lA6uK.gL9D7/tB5Hq17Hee'
          })
          .select()
          .single();

        if (userError) throw userError;

        // 2. Insert group memberships
        if (formData.selectedGroups.length > 0 && newUser) {
          const groupInserts = formData.selectedGroups.map(groupId => ({
            user_id: newUser.id,
            group_id: groupId
          }));
          const { error: groupError } = await supabase
            .from('user_groups')
            .insert(groupInserts);
          if (groupError) throw groupError;
        }

        showToast('Administrator added successfully.');
        setIsAddModalOpen(false);
      } else if (isEditModalOpen && selectedAdmin) {
        // 1. Update user details
        const { error: updateError } = await supabase
          .from('users')
          .update({
            name: formData.name,
            phone_number: formData.mobile,
            company_name: formData.org,
            role: formData.role
          })
          .eq('id', selectedAdmin.id);

        if (updateError) throw updateError;

        // 2. Update group memberships (delete existing and insert new)
        const { error: deleteError } = await supabase
          .from('user_groups')
          .delete()
          .eq('user_id', selectedAdmin.id);

        if (deleteError) throw deleteError;

        if (formData.selectedGroups.length > 0) {
          const groupInserts = formData.selectedGroups.map(groupId => ({
            user_id: selectedAdmin.id,
            group_id: groupId
          }));
          const { error: groupError } = await supabase
            .from('user_groups')
            .insert(groupInserts);
          if (groupError) throw groupError;
        }

        showToast('Administrator updated successfully.');
        setIsEditModalOpen(false);
      }

      // Reset form and refresh
      setFormData({
        name: '',
        email: '',
        mobile: '',
        org: companyName,
        role: 'admin',
        selectedGroups: []
      });
      fetchData();
    } catch (err) {
      console.error('Error submitting form:', err);
      setErrorMsg(err.message || 'An error occurred during submission.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGroupCheckboxChange = (groupId) => {
    setFormData(prev => {
      const isSelected = prev.selectedGroups.includes(groupId);
      const newGroups = isSelected
        ? prev.selectedGroups.filter(id => id !== groupId)
        : [...prev.selectedGroups, groupId];
      return { ...prev, selectedGroups: newGroups };
    });
  };

  // Expiry Date generator (created_at + 1 year, matching MM/DD/YY in drawing)
  const formatExpiryDate = () => {
    return "--";
  };
  return (
    <div className="p-8 max-w-7xl mx-auto relative min-h-screen">
      {/* Dynamic Toasts */}
      {successMsg && (
        <div className="fixed top-6 right-6 z-50 bg-slate-900 text-white px-5 py-3.5 rounded-xl shadow-2xl flex items-center gap-3 border border-slate-800 animate-slide-in">
          <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs">✓</div>
          <span className="text-sm font-semibold">{successMsg}</span>
        </div>
      )}

      {/* Title & Search Row (matching new plan layout) */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          Manage Admin
        </h1>

        {/* Right side container: Export + Search */}
        <div className="flex items-center gap-3">
          {selectedAdminIds.length > 0 && (
            <span className="text-xs text-slate-400 font-semibold">
              {selectedAdminIds.length} selected
            </span>
          )}

          {/* Export Button */}
          <button
            onClick={handleExportCSV}
            className="px-5 py-2 rounded-full border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 font-bold text-xs tracking-wide transition-all active:scale-95 flex items-center gap-1.5 shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Export
          </button>

          {/* Pill Search bar on top right */}
          <div className="relative w-72">
            <input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-5 py-2.5 bg-white border border-slate-200 rounded-full text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand)]/10 transition-all duration-300 shadow-inner-sm"
            />
            <svg
              className="absolute left-4 top-3 text-slate-400"
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
        </div>
      </div>



      {/* Main Administrative Table */}
      {loading ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 shadow-sm flex flex-col items-center justify-center gap-4">
          <div className="w-10 h-10 border-4 border-[var(--brand)]/20 border-t-[var(--brand)] rounded-full animate-spin"></div>
          <p className="text-sm text-slate-400 font-semibold">Fetching administrators...</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md">
          <div className="overflow-x-auto">
            {filteredAdmins.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                </div>
                <p className="text-sm text-slate-400 font-semibold">No administrators found</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse select-none">
                <thead>
                  <tr className="bg-slate-50/50 text-slate-400 font-extrabold text-[11px] tracking-wider border-b border-slate-100">
                    {/* Master Checkbox */}
                    <th className="py-4 px-6 w-12">
                      <input
                        type="checkbox"
                        checked={filteredAdmins.length > 0 && selectedAdminIds.length === filteredAdmins.length}
                        onChange={handleSelectAll}
                        className="w-4 h-4 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]/20 cursor-pointer"
                      />
                    </th>
                    <th className="py-4 px-4">NAME</th>
                    <th className="py-4 px-6">ORGANIZATION</th>
                    <th className="py-4 px-6">EMAIL</th>
                    <th className="py-4 px-6">ROLE</th>
                    <th className="py-4 px-6">MOBILE</th>
                    <th className="py-4 px-6">EXPIRY DATE</th>
                    <th className="py-4 px-6">
                      <div className="flex items-center gap-1 cursor-pointer hover:text-slate-700">
                        STATUS <span className="text-[9px] text-slate-300 font-bold">▼</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAdmins.map(admin => {
                    const isSelected = selectedAdminIds.includes(admin.id);
                    const isUserActive = admin.status === 'active';

                    return (
                      <tr
                        key={admin.id}
                        onContextMenu={(e) => handleContextMenu(e, admin)}
                        className={`hover:bg-slate-50/60 transition-colors duration-200 cursor-context-menu ${isSelected ? 'bg-slate-50/80' : ''
                          } ${!isUserActive ? 'opacity-70' : ''}`}
                      >
                        {/* Checkbox Column */}
                        <td className="py-4.5 px-6">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleSelectAdmin(admin.id)}
                            className="w-4 h-4 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]/20 cursor-pointer"
                          />
                        </td>

                        {/* Name */}
                        <td className="py-4.5 px-4 font-bold text-slate-900 text-[13.5px]">
                          <span className="hover:text-[var(--brand)] transition-colors">{admin.name}</span>
                        </td>

                        {/* Org */}
                        <td className="py-4.5 px-6 text-[13px] text-slate-600 font-bold">
                          {admin.company_name || companyName}
                        </td>

                        {/* Email */}
                        <td className="py-4.5 px-6 text-[13px] text-slate-500 font-medium">
                          {admin.email}
                        </td>

                        {/* Role */}
                        <td className="py-4.5 px-6 text-[13px] text-slate-500 font-medium capitalize">
                          {admin.role ? admin.role.replace('_', ' ') : 'Admin'}
                        </td>

                        {/* Mobile */}
                        <td className="py-4.5 px-6 text-[13px] text-slate-500 font-medium">
                          {admin.phone_number ? `+91 ${admin.phone_number}` : 'N/A'}
                        </td>

                        {/* Expiry Date */}
                        <td className="py-4.5 px-6 text-[13px] text-slate-500 font-semibold">
                          {formatExpiryDate(admin.created_at)}
                        </td>

                        {/* Status */}
                        <td className="py-4.5 px-6">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border ${isUserActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100/60'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${isUserActive ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                            {isUserActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Instructions Overlay at the bottom */}
      <div className="mt-6 text-center">
        <p className="text-[11px] text-slate-400 font-semibold tracking-wide flex items-center justify-center gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
          Pro Tip: Right-click on any administrator row to open the quick action menu (Edit, Inactive, Remove).
        </p>
      </div>

      {/* CUSTOM RIGHT-CLICK CONTEXT MENU PORTAL */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white border border-slate-200/80 rounded-2xl shadow-2xl py-2 w-44 text-left border-slate-100/50 animate-scale-up"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
        >
          {/* Edit */}
          <button
            onClick={() => openEditModal(contextMenu.admin)}
            className="w-full px-4 py-2.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2.5 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            Edit
          </button>

          {/* Toggle Active/Inactive */}
          <button
            onClick={() => handleToggleStatus(contextMenu.admin)}
            className="w-full px-4 py-2.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2.5 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            {contextMenu.admin.status === 'active' ? 'Inactive' : 'Active'}
          </button>

          <div className="border-t border-slate-100 my-1"></div>

          {/* Remove */}
          <button
            onClick={() => handleDeleteAdmin(contextMenu.admin.id)}
            className="w-full px-4 py-2.5 text-xs font-extrabold text-rose-600 hover:bg-rose-50 flex items-center gap-2.5 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
            Remove
          </button>
        </div>
      )}

      {/* ADD / EDIT ADMIN DIALOG MODAL */}
      {(isAddModalOpen || isEditModalOpen) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Overlay */}
          <div
            onClick={() => {
              setIsAddModalOpen(false);
              setIsEditModalOpen(false);
            }}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
          />

          {/* Modal Container */}
          <div className="relative w-full max-w-lg bg-white rounded-2xl border border-slate-100 shadow-2xl p-6.5 z-10 animate-fade-in">
            <h3 className="text-lg font-black text-slate-900 tracking-tight">
              {isAddModalOpen ? 'Add Administrator' : 'Edit Administrator'}
            </h3>
            <p className="text-xs text-slate-400 font-medium mt-1">
              Configure credentials, company organizations, and security group assignments.
            </p>

            {errorMsg && (
              <div className="mt-4 bg-rose-50 border border-rose-100 rounded-xl p-3.5 text-xs text-rose-600 font-semibold leading-relaxed">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
              {/* Name */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="Enter full name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand)]/8 transition-all"
                />
              </div>

              {/* Email (only editable on Add) */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Email Address</label>
                <input
                  type="email"
                  required
                  disabled={isEditModalOpen}
                  placeholder="Enter email address"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  className={`w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand)]/8 transition-all ${isEditModalOpen ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
              </div>

              {/* Row: Mobile & Organization */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Mobile */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Mobile Number</label>
                  <input
                    type="text"
                    placeholder="e.g. 9876543210"
                    value={formData.mobile}
                    onChange={(e) => setFormData(prev => ({ ...prev, mobile: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand)]/8 transition-all"
                  />
                </div>

                {/* Organization */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Organization</label>
                  <input
                    type="text"
                    placeholder="Enter organization"
                    value={formData.org}
                    onChange={(e) => setFormData(prev => ({ ...prev, org: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand)]/8 transition-all"
                  />
                </div>
              </div>

              {/* Admin Role */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Administrative Level</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand)]/8 transition-all"
                >
                  <option value="admin">Administrator (Full Access)</option>
                  <option value="sub_admin">Sub-Administrator (Restricted Access)</option>
                </select>
              </div>

              {/* Group Assignments */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Assign Groups</label>
                <div className="mt-1 bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-36 overflow-y-auto flex flex-col gap-2.5 shadow-inner-sm">
                  {groups.length === 0 ? (
                    <span className="text-xs text-slate-400 font-semibold py-2 text-center">No groups available in this workspace</span>
                  ) : (
                    groups.map(group => {
                      const isChecked = formData.selectedGroups.includes(group.id);
                      return (
                        <label key={group.id} className="flex items-center gap-2.5 cursor-pointer py-0.5 group">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleGroupCheckboxChange(group.id)}
                            className="w-4 h-4 rounded text-[var(--brand)] focus:ring-[var(--brand)]/20 border-slate-300"
                          />
                          <div>
                            <span className="text-xs font-bold text-slate-700 group-hover:text-slate-900 transition-colors">{group.name}</span>
                            {group.description && (
                              <span className="block text-[10px] text-slate-400 font-medium truncate max-w-[360px]">{group.description}</span>
                            )}
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Actions Footer */}
              <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddModalOpen(false);
                    setIsEditModalOpen(false);
                  }}
                  className="px-4.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-600 text-xs font-bold tracking-wide transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[var(--brand)] to-[var(--brand-secondary)] text-white text-xs font-extrabold tracking-wide hover:shadow-lg hover:shadow-[var(--brand)]/15 active:scale-95 disabled:opacity-60 disabled:pointer-events-none transition-all flex items-center gap-2"
                >
                  {submitting && <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>}
                  {isAddModalOpen ? 'Save Admin' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
