"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/utils/supabase/client";
import { FaUser, FaEnvelope, FaLock, FaEye, FaEyeSlash, FaCheckCircle, FaShieldAlt, FaBuilding, FaSearch, FaCaretDown, FaSpinner, FaTimesCircle } from "react-icons/fa";
import { FiShield } from "react-icons/fi";
import { countries, normalizePhoneNumber, formatPhoneDisplay } from "@/utils/countries";

// =========================================================================
// 1. INVITE REGISTRATION COMPONENT (FOR USERS WITH A TOKEN)
// =========================================================================
function InviteRegisterContent({ token }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [isExistingUser, setIsExistingUser] = useState(false);
  const [sessionUser, setSessionUser] = useState(null);

  const [inviteData, setInviteData] = useState(null);
  const [companyData, setCompanyData] = useState(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    const fetchInvite = async () => {
      try {
        const res = await fetch(`/api/auth/register/invite?token=${encodeURIComponent(token)}`);
        const resData = await res.json();
        
        if (!res.ok) throw new Error(resData.error || "Invitation not found or expired.");

        const { invite, company } = resData;

        setInviteData(invite);
        setEmail(invite.email);
        if (company) setCompanyData(company);

        // Check if user is already logged in
        const sessionString = localStorage.getItem('vdr_session');
        let currentSessionUser = null;
        if (sessionString) {
          try {
            currentSessionUser = JSON.parse(sessionString);
            setSessionUser(currentSessionUser);
          } catch (e) {
            console.error("Error parsing session", e);
          }
        }

        // If not logged in or email doesn't match, check if user exists in DB
        if (!currentSessionUser || currentSessionUser.email !== invite.email) {
          const res = await fetch(`/api/user/check?email=${encodeURIComponent(invite.email)}`);
          if (res.ok) {
            const data = await res.json();
            setIsExistingUser(data.exists);
          }
        }

      } catch (err) {
        console.error(err);
        setErrorMsg(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchInvite();
  }, [token]);

  const handleAcceptExisting = async () => {
    setErrorMsg("");
    setSubmitting(true);
    try {
      if (!sessionUser) throw new Error("You must be logged in to accept this invitation.");

      const targetRole = inviteData.groups?.role || "external_user";

      const assignRes = await fetch("/api/invite/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
              user_id: sessionUser.id,
              invitation_id: inviteData.id,
              group_id: inviteData.group_id,
              workspace_id: inviteData.groups?.workspace_id,
              role: targetRole,
              invited_by: inviteData.invited_by
          })
      });
      const assignData = await assignRes.json();
      if (!assignRes.ok) throw new Error(assignData.error || "Failed to assign workspace access");

      // Update session if NDA is required for this new workspace
      if (inviteData.requires_nda) {
        sessionUser.nda_status = "pending";
        localStorage.setItem('vdr_session', JSON.stringify(sessionUser));
        router.push("/sign-nda");
      } else {
        router.push("/workspace");
      }
    } catch (err) {
      console.error("Accept error:", err);
      setErrorMsg(err.message || "Failed to accept invitation. Please try again.");
      setSubmitting(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    if (!name.trim()) {
      setErrorMsg("Please enter your full name.");
      return;
    }

    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    setSubmitting(true);

    try {
      const assignedNdaStatus = inviteData.requires_nda ? "pending" : "not_required";
      let userId = crypto.randomUUID();

      // Create user via new API
      const userRes = await fetch("/api/auth/register/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          companyId: companyData.id,
          name,
          email: inviteData.email,
          password,
          requiresNda: inviteData.requires_nda
        })
      });
      const userData = await userRes.json();
      if (!userRes.ok) throw new Error(userData.error || "Failed to create user account.");

      const targetRole = inviteData.groups?.role || "external_user";

      // 3. Call secure backend to assign permissions and update invitation
      const assignRes = await fetch("/api/invite/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
              user_id: userId,
              invitation_id: inviteData.id,
              group_id: inviteData.group_id,
              workspace_id: inviteData.groups?.workspace_id,
              role: targetRole,
              invited_by: inviteData.invited_by
          })
      });
      const assignData = await assignRes.json();
      if (!assignRes.ok) throw new Error(assignData.error || "Failed to assign workspace access");

      // THE FORK IN THE ROAD
      if (inviteData.requires_nda) {
        localStorage.setItem('vdr_session', JSON.stringify({
          id: userId,
          company_id: companyData.id,
          name: name,
          email: inviteData.email,
          role: "user",
          nda_status: assignedNdaStatus
        }));
        router.push("/sign-nda?from=register");
      } else {
        localStorage.removeItem('vdr_session');
        setIsSuccess(true);
      }

    } catch (err) {
      console.error("Registration error:", err);
      setErrorMsg(err.message || "Registration failed. Please try again.");
      setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 font-medium">Validating Invitation...</div>;

  // SUCCESS SCREEN
  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[var(--brand)]/10 via-white to-[var(--brand-secondary)]/10 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full text-center border border-gray-100 animate-in zoom-in-95 duration-300">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-500">
            <FaCheckCircle className="text-4xl" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Registration Successful!</h2>
          <p className="text-gray-600 text-sm mb-6">Your account has been created. You can now log in to access the Virtual Data Room.</p>
          <button
            onClick={() => router.push("/login")}
            className="w-full py-3 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white font-semibold rounded-xl transition-all duration-300 shadow-lg shadow-[var(--brand)]/20"
          >
            Go to Login
          </button>
          <button
            onClick={() =>
              router.push(
                `/verify-email?email=${encodeURIComponent(inviteData?.email || "")}`
              )
            }
            className="w-full py-2.5 mt-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-all duration-300 text-sm cursor-pointer"
          >
            Verify Email Address
          </button>
        </div>
      </div>
    );
  }

  // ERROR SCREEN
  if (errorMsg && !inviteData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-rose-100 max-w-md w-full text-center">
          <FaShieldAlt className="text-rose-500 text-4xl mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Access Denied</h2>
          <p className="text-slate-500 text-sm mb-6">{errorMsg}</p>
          <button onClick={() => router.push('/login')} className="w-full py-2.5 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800 transition-all">Go to Login</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[var(--brand)]/10 via-white to-[var(--brand-secondary)]/10 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-96 h-96 bg-[var(--brand)]/10 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse"></div>
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-[var(--brand-secondary)]/10 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse"></div>

      <div className="relative w-full max-w-md">
        {/* Header */}
        <div className="flex flex-col items-center justify-center gap-3 mb-8 text-center">
          <div className="w-12 h-12 rounded-xl brand-gradient flex items-center justify-center shadow-md shadow-[var(--brand)]/20">
            <FiShield className="text-white text-2xl" strokeWidth={2.8} />
          </div>
          <div>
            <h1 className="text-4xl font-bold text-slate-900">Join {companyData?.name || "Workspace"}</h1>
            <p className="text-gray-600 text-sm mt-1">Register for Virtual Data Room Access</p>
          </div>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-6 sm:p-8 backdrop-blur-sm border border-gray-100">
          {errorMsg && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
              <span className="text-red-500 mt-0.5">⚠️</span>
              <div>
                <p className="text-red-800 font-medium text-sm">Error</p>
                <p className="text-red-700 text-xs mt-0.5">{errorMsg}</p>
              </div>
            </div>
          )}

          {sessionUser && sessionUser.email === inviteData?.email ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-500">
                <FaUser className="text-3xl" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Welcome back, {sessionUser.name}!</h2>
              <p className="text-slate-600 text-sm mb-6">
                You are currently logged in. Click below to accept the invitation and join the workspace.
              </p>
              <button
                onClick={handleAcceptExisting}
                disabled={submitting}
                className="w-full py-3 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white font-semibold rounded-xl transition-all duration-300 shadow-lg flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <span>Accept Invitation</span>
                )}
              </button>
            </div>
          ) : isExistingUser ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-500">
                <FaLock className="text-3xl" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Account Already Exists</h2>
              <p className="text-slate-600 text-sm mb-6">
                An account with the email <strong>{inviteData?.email}</strong> is already registered. Please log in to accept this invitation.
              </p>
              <button
                onClick={() => {
                  sessionStorage.setItem("vdr_redirect_url", `/register?token=${token}`);
                  router.push("/login");
                }}
                className="w-full py-3 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white font-semibold rounded-xl transition-all duration-300 shadow-lg"
              >
                Log In to Accept
              </button>
            </div>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Full Name</label>
              <div className="relative">
                <FaUser className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-base" />
                <input
                  type="text"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={submitting}
                  required
                  className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--brand)] transition disabled:bg-gray-100 placeholder-gray-400 text-gray-900 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email Address</label>
              <div className="relative">
                <FaEnvelope className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-base" />
                <input
                  type="email"
                  value={email}
                  disabled={true}
                  required
                  className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none transition disabled:bg-gray-100 text-gray-900 text-sm cursor-not-allowed"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Password</label>
              <div className="relative">
                <FaLock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-base" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Minimum 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  required
                  minLength={6}
                  className="w-full pl-11 pr-11 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--brand)] transition disabled:bg-gray-100 placeholder-gray-400 text-gray-900 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                >
                  {showPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Confirm Password</label>
              <div className="relative">
                <FaLock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-base" />
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={submitting}
                  required
                  minLength={6}
                  className="w-full pl-11 pr-11 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--brand)] transition disabled:bg-gray-100 placeholder-gray-400 text-gray-900 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                >
                  {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 py-3 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white font-semibold rounded-xl transition-all duration-300 disabled:opacity-70 flex items-center justify-center gap-2 shadow-lg"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Processing...</span>
                </>
              ) : (
                <span>{inviteData?.requires_nda ? "Next: Review Security Terms" : "Request Workspace"}</span>
              )}
            </button>
          </form>
          )}

          <div className="mt-6 pt-4 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-600">
              Already have an account?{" "}
              <Link href="/login" className="text-[var(--brand)] font-semibold hover:underline">
                Log In
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}


// =========================================================================
// 2. COMPANY REGISTRATION COMPONENT (NO TOKEN)
// =========================================================================
function CompanyRegisterContent() {
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [plans, setPlans] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Email state
  const [adminEmail, setAdminEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState("idle"); // idle | checking | available | exists | invalid
  
  // Phone state
  const [selectedCountry, setSelectedCountry] = useState(countries.find(c => c.code === "US"));
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneStatus, setPhoneStatus] = useState("idle"); // idle | checking | available | exists | invalid

  const [otpCode, setOtpCode] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [countdown, setCountdown] = useState(60);

  // Email debounce & check
  useEffect(() => {
    const emailStr = adminEmail.trim().toLowerCase();
    if (!emailStr) {
      setEmailStatus("idle");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailStr)) {
      setEmailStatus("invalid");
      return;
    }

    setEmailStatus("checking");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/user/check?email=${encodeURIComponent(emailStr)}`);
        const data = await res.json();
        if (data.exists) {
          setEmailStatus("exists");
        } else {
          setEmailStatus("available");
        }
      } catch (err) {
        setEmailStatus("idle");
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [adminEmail]);

  // Phone debounce & check
  useEffect(() => {
    const phoneStr = phone.trim();
    if (!phoneStr) {
      setPhoneStatus("idle");
      return;
    }
    
    // minimal length check for local portion
    const digits = phoneStr.replace(/\D/g, "");
    if (digits.length < 5) {
      setPhoneStatus("invalid");
      return;
    }

    setPhoneStatus("checking");
    const timer = setTimeout(async () => {
      try {
        const normalized = normalizePhoneNumber(selectedCountry.dialCode, phoneStr);
        const res = await fetch(`/api/user/check?phone=${encodeURIComponent(normalized)}`);
        const data = await res.json();
        if (data.exists) {
          setPhoneStatus("exists");
        } else {
          setPhoneStatus("available");
        }
      } catch (err) {
        setPhoneStatus("idle");
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [phone, selectedCountry]);

  useEffect(() => {
    let timer;
    if (step === 2 && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [step, countdown]);

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const res = await fetch("/api/plans");
        if (!res.ok) throw new Error("Failed to fetch plans");
        const data = await res.json();
        setPlans(data || []);
      } catch (err) {
        console.error("Error fetching plans:", err);
      } finally {
        setLoadingPlans(false);
      }
    };
    fetchPlans();
  }, []);

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    if (!companyName.trim() || !adminName.trim() || !adminEmail.trim() || !phone.trim()) {
      setErrorMsg("Please fill in all required fields.");
      return;
    }

    if (emailStatus === "invalid") {
      setErrorMsg("Please enter a valid email address.");
      return;
    }
    if (emailStatus === "exists") {
      setErrorMsg("This email address is already registered.");
      return;
    }
    if (emailStatus === "checking") {
      setErrorMsg("Please wait while we verify your email.");
      return;
    }

    if (phoneStatus === "invalid") {
      setErrorMsg("Please enter a valid phone number.");
      return;
    }
    if (phoneStatus === "exists") {
      setErrorMsg("This phone number is already registered.");
      return;
    }
    if (phoneStatus === "checking") {
      setErrorMsg("Please wait while we verify your phone number.");
      return;
    }

    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters long.");
      return;
    }
    
    // Check required cases
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      setErrorMsg("Password must contain uppercase, lowercase, number, and special character.");
      return;
    }
    if (password === adminEmail || password === adminName) {
      setErrorMsg("Password must not equal your email or name.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    
    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: adminEmail.trim() }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send OTP");
      
      setCountdown(60);
      setStep(2);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    if (otpCode.length !== 6) {
      setErrorMsg("Please enter a valid 6-digit code.");
      return;
    }

    setSubmitting(true);
    
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: adminEmail.trim(), otp: otpCode }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid OTP code");
      
      setStep(3);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    setErrorMsg("");
    setSubmitting(true);
    
    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: adminEmail.trim() }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to resend OTP");
      
      setCountdown(60);
      setOtpCode("");
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinalSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPlanId) return;

    setErrorMsg("");
    setSubmitting(true);

    try {
      const normalizedPhone = normalizePhoneNumber(selectedCountry.dialCode, phone);

      const res = await fetch("/api/request-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          adminName: adminName.trim(),
          adminEmail: adminEmail.trim(),
          phone: normalizedPhone,
          password,
          planId: selectedPlanId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to register company.");
      }

      setIsSuccess(true);
    } catch (err) {
      console.error("Registration error:", err);
      setErrorMsg(err.message || "Registration failed. Please try again.");
      setSubmitting(false);
    }
  };

  const filteredCountries = countries.filter(c => 
    c.name.toLowerCase().includes(countrySearch.toLowerCase()) || 
    c.dialCode.includes(countrySearch)
  );

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm max-w-md w-full text-center border border-slate-200 animate-in zoom-in-95 duration-300">
          <div className="w-16 h-16 bg-[var(--brand)]/10 rounded-full flex items-center justify-center mx-auto mb-4 text-[var(--brand)]">
            <FaCheckCircle className="text-3xl" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Registration Submitted!</h2>
          <p className="text-slate-600 text-sm mb-6">
            Your VDR account is currently pending executive approval. You will be notified once our team reviews your request.
          </p>
          <button
            onClick={() => router.push("/login")}
            className="w-full py-3 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white font-semibold rounded-xl transition-all duration-300 shadow-2xs"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 py-12 relative">

      <div className={`relative w-full ${step === 3 ? "max-w-4xl" : "max-w-lg"}`}>
        {/* Header */}
        <div className="flex flex-col items-center justify-center gap-3 mb-8 text-center">
          <div className="w-12 h-12 rounded-xl brand-gradient flex items-center justify-center shadow-md shadow-[var(--brand)]/20">
            <FiShield className="text-white text-2xl" strokeWidth={2.8} />
          </div>
          <div>
            <h1 className="text-4xl font-bold text-slate-900">
              {step === 1 && "Get Started"}
              {step === 2 && "Verify Email"}
              {step === 3 && "Select a Plan"}
            </h1>
            <p className="text-gray-600 text-sm mt-1">
              {step === 1 && "Register your organization for VDR Access"}
              {step === 2 && `We sent a code to ${adminEmail}`}
              {step === 3 && "Choose the right capacity for your organization"}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="flex justify-center gap-2 mb-6">
          <div className={`h-1.5 w-12 rounded-full ${step >= 1 ? 'bg-[var(--brand)]' : 'bg-gray-200'}`}></div>
          <div className={`h-1.5 w-12 rounded-full ${step >= 2 ? 'bg-[var(--brand)]' : 'bg-gray-200'}`}></div>
          <div className={`h-1.5 w-12 rounded-full ${step >= 3 ? 'bg-[var(--brand)]' : 'bg-gray-200'}`}></div>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-6 sm:p-8 backdrop-blur-sm border border-gray-100">
          {errorMsg && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
              <span className="text-red-500 mt-0.5">⚠️</span>
              <div>
                <p className="text-red-800 font-medium text-sm">Registration Error</p>
                <p className="text-red-700 text-xs mt-0.5">{errorMsg}</p>
              </div>
            </div>
          )}

          {/* STEP 1: Basic Details */}
          {step === 1 && (
            <form onSubmit={handleSendOtp} className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Organization Name</label>
                <div className="relative">
                  <FaBuilding className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-base" />
                  <input
                    type="text"
                    placeholder="Acme Corp"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    disabled={submitting}
                    required
                    minLength={2}
                    maxLength={100}
                    className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--brand)] transition disabled:bg-gray-100 placeholder-gray-400 text-gray-900 text-sm"
                  />
                </div>
              </div>

              <div className="my-5 flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-200"></div>
                <span className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Admin Details</span>
                <div className="flex-1 h-px bg-gray-200"></div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Admin Full Name</label>
                <div className="relative">
                  <FaUser className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-base" />
                  <input
                    type="text"
                    placeholder="John Doe"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value.replace(/[0-9!@#$%^&*()_+=\[\]{};':"\\|,.<>\/?]+/, ''))}
                    disabled={submitting}
                    required
                    className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--brand)] transition disabled:bg-gray-100 placeholder-gray-400 text-gray-900 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Admin Email Address</label>
                <div className="relative">
                  <FaEnvelope className={`absolute left-4 top-1/2 -translate-y-1/2 text-base ${emailStatus === 'invalid' || emailStatus === 'exists' ? 'text-red-400' : 'text-gray-400'}`} />
                  <input
                    type="email"
                    placeholder="name@company.com"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    disabled={submitting}
                    required
                    className={`w-full pl-11 pr-11 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--brand)] transition disabled:bg-gray-100 placeholder-gray-400 text-sm
                      ${(emailStatus === 'invalid' || emailStatus === 'exists') ? 'border-red-300 bg-red-50 text-red-900 focus:ring-red-400' : 'border-gray-300 text-gray-900'}
                      ${emailStatus === 'available' ? 'border-emerald-300 bg-emerald-50/20' : ''}
                    `}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center">
                    {emailStatus === 'checking' && <FaSpinner className="text-[var(--brand)] animate-spin" />}
                    {emailStatus === 'available' && <FaCheckCircle className="text-emerald-500" />}
                    {(emailStatus === 'invalid' || emailStatus === 'exists') && <FaTimesCircle className="text-red-500" />}
                  </div>
                </div>
                {emailStatus === 'invalid' && <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1"><FaTimesCircle className="shrink-0"/> Please enter a valid email address.</p>}
                {emailStatus === 'exists' && <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1"><FaTimesCircle className="shrink-0"/> This email address is already registered.</p>}
                {emailStatus === 'checking' && <p className="text-[var(--brand)] text-xs mt-1.5 flex items-center gap-1"><FaSpinner className="animate-spin shrink-0"/> Checking email...</p>}
                {emailStatus === 'available' && <p className="text-emerald-600 text-xs mt-1.5 flex items-center gap-1"><FaCheckCircle className="shrink-0"/> Email is available.</p>}
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Phone Number</label>
                <div className={`relative flex rounded-xl border bg-white focus-within:ring-2 focus-within:ring-[var(--brand)] transition group
                  ${(phoneStatus === 'invalid' || phoneStatus === 'exists') ? 'border-red-300 ring-red-400 focus-within:ring-red-400 bg-red-50' : 'border-gray-300'}
                `}>
                  
                  {/* Country Selector Button */}
                  <button
                    type="button"
                    onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                    disabled={submitting}
                    className="flex items-center gap-1.5 px-3 py-3 border-r border-gray-200 hover:bg-gray-50 transition rounded-l-xl text-sm min-w-fit"
                  >
                    <span className="text-lg">{selectedCountry?.flag}</span>
                    <span className="text-gray-700 font-medium">{selectedCountry?.dialCode}</span>
                    <FaCaretDown className="text-gray-400 text-xs ml-0.5" />
                  </button>

                  {/* Phone Input */}
                  <input
                    type="tel"
                    placeholder="Phone number"
                    value={phone}
                    onChange={(e) => setPhone(formatPhoneDisplay(e.target.value))}
                    disabled={submitting}
                    required
                    className={`flex-1 min-w-0 pl-3 pr-10 py-3 bg-transparent border-none focus:ring-0 focus:outline-none text-sm placeholder-gray-400 text-gray-900
                      ${(phoneStatus === 'invalid' || phoneStatus === 'exists') ? 'text-red-900' : ''}
                    `}
                  />
                  
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center">
                    {phoneStatus === 'checking' && <FaSpinner className="text-[var(--brand)] animate-spin" />}
                    {phoneStatus === 'available' && <FaCheckCircle className="text-emerald-500" />}
                    {(phoneStatus === 'invalid' || phoneStatus === 'exists') && <FaTimesCircle className="text-red-500" />}
                  </div>

                  {/* Dropdown Menu */}
                  {showCountryDropdown && (
                    <div className="absolute top-full left-0 mt-1 w-72 max-h-60 bg-white border border-gray-200 rounded-xl shadow-xl z-50 flex flex-col overflow-hidden">
                      <div className="p-2 border-b border-gray-100 flex items-center gap-2">
                        <FaSearch className="text-gray-400 text-xs ml-2 shrink-0" />
                        <input
                          type="text"
                          autoFocus
                          placeholder="Search country..."
                          value={countrySearch}
                          onChange={(e) => setCountrySearch(e.target.value)}
                          className="w-full text-sm py-1.5 focus:outline-none text-gray-800"
                        />
                      </div>
                      <div className="overflow-y-auto">
                        {filteredCountries.length > 0 ? (
                          filteredCountries.map((c) => (
                            <button
                              key={c.code}
                              type="button"
                              onClick={() => {
                                setSelectedCountry(c);
                                setShowCountryDropdown(false);
                                setCountrySearch("");
                              }}
                              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition text-left"
                            >
                              <span className="text-lg">{c.flag}</span>
                              <span className="text-sm font-medium text-gray-800 flex-1">{c.name}</span>
                              <span className="text-xs text-gray-500">{c.dialCode}</span>
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-3 text-sm text-gray-500 text-center">No countries found</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {/* Overlay to close dropdown */}
                {showCountryDropdown && (
                  <div className="fixed inset-0 z-40" onClick={() => setShowCountryDropdown(false)}></div>
                )}
                
                {phoneStatus === 'exists' && <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1"><FaTimesCircle className="shrink-0"/> This phone number is already registered.</p>}
                {phoneStatus === 'invalid' && <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1"><FaTimesCircle className="shrink-0"/> Please enter a valid phone number.</p>}
                {phoneStatus === 'available' && <p className="text-emerald-600 text-xs mt-1.5 flex items-center gap-1"><FaCheckCircle className="shrink-0"/> Phone number is available.</p>}
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Password</label>
                <div className="relative">
                  <FaLock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-base" />
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Minimum 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                    required
                    minLength={6}
                    className="w-full pl-11 pr-11 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--brand)] transition disabled:bg-gray-100 placeholder-gray-400 text-gray-900 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                  >
                    {showPassword ? <FaEyeSlash /> : <FaEye />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Confirm Password</label>
                <div className="relative">
                  <FaLock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-base" />
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={submitting}
                    required
                    minLength={6}
                    className="w-full pl-11 pr-11 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--brand)] transition disabled:bg-gray-100 placeholder-gray-400 text-gray-900 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                  >
                    {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
                  </button>
                </div>
                {confirmPassword && password !== confirmPassword && (
                  <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1"><FaTimesCircle/> Passwords do not match.</p>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting || emailStatus === 'checking' || phoneStatus === 'checking'}
                className="w-full mt-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition-all duration-300 disabled:opacity-70 flex items-center justify-center gap-2 shadow-lg"
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Sending Code...</span>
                  </>
                ) : (
                  <span>Send OTP Verification</span>
                )}
              </button>
            </form>
          )}

          {/* STEP 2: OTP Verification */}
          {step === 2 && (
            <form onSubmit={handleVerifyOtp} className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-500 shadow-inner shadow-blue-100">
                  <FaShieldAlt className="text-3xl" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Verify Your Email</h2>
                <p className="text-slate-500 text-sm max-w-xs mx-auto leading-relaxed">
                  We've sent a 6-digit verification code to <br/>
                  <strong className="text-slate-800 font-semibold">{adminEmail}</strong>
                </p>
              </div>

              <div className="relative max-w-[300px] mx-auto">
                <div className="flex justify-between gap-2">
                  {[0, 1, 2, 3, 4, 5].map((index) => {
                    const digit = otpCode[index] || "";
                    const isFocused = otpCode.length === index;
                    return (
                      <div
                        key={index}
                        className={`w-11 h-14 flex items-center justify-center text-2xl font-bold rounded-xl border-2 transition-all duration-300
                          ${digit ? 'border-[var(--brand)] text-slate-800 bg-white shadow-sm' : 'border-gray-200 text-slate-300 bg-gray-50'}
                          ${isFocused ? 'border-[var(--brand)] ring-4 ring-[var(--brand)]/10 bg-white' : ''}
                        `}
                      >
                        {digit}
                      </div>
                    );
                  })}
                </div>
                {/* Hidden Input for Mobile Keyboard & Desktop Typing */}
                <input
                  type="text"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  disabled={submitting}
                  autoFocus
                  required
                  className="absolute inset-0 w-full h-full opacity-0 cursor-text z-10"
                />
              </div>

              <div className="text-center -mt-2">
                {countdown > 0 ? (
                  <p className="text-sm text-slate-500 font-medium">
                    Code expires in <span className="text-[var(--brand)] font-bold">{countdown}s</span>
                  </p>
                ) : (
                  <div className="flex flex-col items-center gap-2 mt-2">
                    <p className="text-sm text-rose-500 font-medium">Code has expired</p>
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={submitting}
                      className="px-6 py-2 border-2 border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)] hover:text-white font-semibold rounded-xl transition-all duration-300 text-sm shadow-sm flex items-center gap-2"
                    >
                      {submitting ? "Sending..." : "Resend Code"}
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={submitting}
                  className="flex-1 py-3.5 bg-slate-50 hover:bg-slate-100 text-slate-600 font-semibold rounded-xl transition-all duration-300 border border-slate-200"
                >
                  Go Back
                </button>
                <button
                  type="submit"
                  disabled={submitting || otpCode.length !== 6 || countdown === 0}
                  className="flex-[2] py-3.5 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white font-semibold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-2 shadow-lg shadow-[var(--brand)]/20"
                >
                  {submitting ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <span>Verify & Continue</span>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* STEP 3: Plan Selection */}
          {step === 3 && (
            <form onSubmit={handleFinalSubmit} className="animate-in fade-in slide-in-from-bottom-4 duration-700">
              
              {loadingPlans ? (
                <div className="text-center py-12">
                  <div className="w-8 h-8 border-4 border-[var(--brand)] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                  <p className="text-slate-500 font-medium">Loading subscription plans...</p>
                </div>
              ) : plans.length === 0 ? (
                <div className="text-center py-12 bg-red-50 rounded-xl border border-red-100">
                  <p className="text-red-500 font-medium">No plans available.</p>
                  <p className="text-sm text-red-400 mt-2">Please contact support.</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    {plans.map((plan) => (
                      <div 
                        key={plan.id}
                        onClick={() => setSelectedPlanId(plan.id)}
                        className={`relative rounded-2xl border transition-all duration-200 cursor-pointer overflow-hidden p-6 flex flex-col items-center text-center
                          ${selectedPlanId === plan.id 
                            ? 'border-[var(--brand)] ring-2 ring-[var(--brand)]/20 bg-[var(--brand)]/5 shadow-sm' 
                            : 'border-slate-200 hover:border-slate-300 bg-white'}`}
                      >
                        {selectedPlanId === plan.id && (
                          <div className="absolute top-4 right-4 text-[var(--brand)]">
                            <FaCheckCircle className="text-lg" />
                          </div>
                        )}
                        <h3 className={`text-lg font-bold mb-2 ${selectedPlanId === plan.id ? 'text-[var(--brand)]' : 'text-slate-900'}`}>
                          {plan.name}
                        </h3>
                        <div className="w-10 h-0.5 bg-slate-200 rounded-full my-4"></div>
                        <p className="text-3xl font-extrabold text-slate-900 mb-1">
                          {plan.storage_limit_mb >= 1024 && plan.storage_limit_mb % 1024 === 0 ? (
                            <>
                              {plan.storage_limit_mb / 1024}
                              <span className="text-sm font-semibold text-slate-500 ml-1">GB</span>
                            </>
                          ) : (
                            <>
                              {plan.storage_limit_mb}
                              <span className="text-sm font-semibold text-slate-500 ml-1">MB</span>
                            </>
                          )}
                        </p>
                        <p className="text-xs text-slate-500 mb-6 font-medium uppercase tracking-wider">Total Storage</p>
                        
                        <div className="w-full bg-slate-50 py-2.5 rounded-xl border border-slate-100 mt-auto">
                          <p className="text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5">
                            <FaUser className="text-slate-400" />
                            Up to {plan.users_limit} Users
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-center max-w-sm mx-auto">
                    <button
                      type="submit"
                      disabled={submitting || !selectedPlanId}
                      className="w-full py-3.5 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white font-semibold rounded-xl transition-all shadow-2xs disabled:opacity-50 flex items-center justify-center gap-2.5 text-base"
                    >
                      {submitting ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          <span>Finalizing...</span>
                        </>
                      ) : (
                        <span>Request Workspace</span>
                      )}
                    </button>
                  </div>
                </>
              )}
            </form>
          )}

          {/* Login Link (Only show on Step 1) */}
          {step === 1 && (
            <div className="mt-6 pt-4 border-t border-gray-100 text-center">
              <p className="text-sm text-gray-600">
                Already registered?{" "}
                <Link href="/login" className="text-[var(--brand)] font-semibold hover:underline">
                  Log In
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 3. MAIN COMPONENT (SWITCHES BASED ON TOKEN)
// =========================================================================
function RegisterController() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  // If token exists, use the INVITE flow.
  // Otherwise, use the COMPANY REGISTRATION flow.
  if (token) {
    return <InviteRegisterContent token={token} />;
  }

  return <CompanyRegisterContent />;
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 font-medium">Loading...</div>}>
      <RegisterController />
    </Suspense>
  );
}
