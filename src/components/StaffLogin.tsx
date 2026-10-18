import React, { useState, useRef } from 'react';
import { Phone, KeyRound, Loader2, ArrowLeft } from 'lucide-react';
import Select, { SingleValue } from 'react-select';
import BrandLogo from './BrandLogo';

interface StaffLoginProps {
  branding: any;
  onLoginSuccess: () => void;
}

const countryOptions = [
  { value: '+213', label: '+213 (DZ)' }, { value: '+244', label: '+244 (AO)' }, { value: '+229', label: '+229 (BJ)' },
  { value: '+267', label: '+267 (BW)' }, { value: '+226', label: '+226 (BF)' }, { value: '+257', label: '+257 (BI)' },
  { value: '+238', label: '+238 (CV)' }, { value: '+237', label: '+237 (CM)' }, { value: '+236', label: '+236 (CF)' },
  { value: '+235', label: '+235 (TD)' }, { value: '+269', label: '+269 (KM)' }, { value: '+243', label: '+243 (CD)' },
  { value: '+242', label: '+242 (CG)' }, { value: '+225', label: '+225 (CI)' }, { value: '+253', label: '+253 (DJ)' },
  { value: '+20', label: '+20 (EG)' }, { value: '+240', label: '+240 (GQ)' }, { value: '+291', label: '+291 (ER)' },
  { value: '+251', label: '+251 (ET)' }, { value: '+241', label: '+241 (GA)' }, { value: '+220', label: '+220 (GM)' },
  { value: '+233', label: '+233 (GH)' }, { value: '+224', label: '+224 (GN)' }, { value: '+245', label: '+245 (GW)' },
  { value: '+254', label: '+254 (KE)' }, { value: '+266', label: '+266 (LS)' }, { value: '+231', label: '+231 (LR)' },
  { value: '+218', label: '+218 (LY)' }, { value: '+261', label: '+261 (MG)' }, { value: '+265', label: '+265 (MW)' },
  { value: '+223', label: '+223 (ML)' }, { value: '+222', label: '+222 (MR)' }, { value: '+230', label: '+230 (MU)' },
  { value: '+212', label: '+212 (MA)' }, { value: '+258', label: '+258 (MZ)' }, { value: '+264', label: '+264 (NA)' },
  { value: '+227', label: '+227 (NE)' }, { value: '+234', label: '+234 (NG)' }, { value: '+250', label: '+250 (RW)' },
  { value: '+239', label: '+239 (ST)' }, { value: '+221', label: '+221 (SN)' }, { value: '+248', label: '+248 (SC)' },
  { value: '+232', label: '+232 (SL)' }, { value: '+252', label: '+252 (SO)' }, { value: '+27', label: '+27 (ZA)' },
  { value: '+211', label: '+211 (SS)' }, { value: '+249', label: '+249 (SD)' }, { value: '+268', label: '+268 (SZ)' },
  { value: '+255', label: '+255 (TZ)' }, { value: '+228', label: '+228 (TG)' }, { value: '+216', label: '+216 (TN)' },
  { value: '+256', label: '+256 (UG)' }, { value: '+260', label: '+260 (ZM)' }, { value: '+263', label: '+263 (ZW)' },
];

export default function StaffLogin({ branding, onLoginSuccess }: StaffLoginProps) {
  const [countryCode, setCountryCode] = useState('+255');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [stage, setStage] = useState<'INPUT_PHONE' | 'INPUT_OTP'>('INPUT_PHONE');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const fullPhoneNumber = `${countryCode}${phoneNumber.startsWith('0') ? phoneNumber.slice(1) : phoneNumber}`;

  const handleLogin = async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/staff/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: fullPhoneNumber }),
      });
      const data = await response.json();
      if (data.success) {
        setStage('INPUT_OTP');
      } else {
        setError(data.error || 'Failed to request OTP');
      }
    } catch (err) {
      setError('An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const verifyOtp = async (otpCode: string) => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/staff/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: fullPhoneNumber, otp: otpCode }),
      });
      const data = await response.json();
      if (data.success) {
        onLoginSuccess();
      } else {
        setError(data.error || 'Invalid OTP');
      }
    } catch (err) {
      setError('An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (isNaN(Number(value))) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    } else if (value && index === 5) {
      verifyOtp(newOtp.join(''));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
        <div className="flex justify-center mb-6">
           <BrandLogo url={branding?.loginLogoUrl || branding?.logoUrl} name={branding?.name || 'Tai Lounge'} size={150} />
        </div>
        
        {error && <p className="text-rose-500 text-xs mb-4 text-center">{error}</p>}

        {stage === 'INPUT_PHONE' ? (
          <div className="space-y-4">
            <div>
              <label className="block text-slate-400 text-xs mb-1">Phone Number</label>
              <div className="flex gap-2">
                <Select
                  value={countryOptions.find(o => o.value === countryCode)}
                  onChange={(val: SingleValue<{ value: string; label: string }>) => val && setCountryCode(val.value)}
                  options={countryOptions}
                  className="text-xs w-32"
                  styles={{
                    control: (base) => ({ ...base, backgroundColor: '#020617', borderColor: '#1e293b', borderRadius: '0.75rem', padding: '2px' }),
                    menu: (base) => ({ ...base, backgroundColor: '#0f172a', color: '#f1f5f9' }),
                    option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? '#475569' : '#0f172a' }),
                    singleValue: (base) => ({ ...base, color: '#f1f5f9' }),
                    input: (base) => ({ ...base, color: '#f1f5f9' }),
                  }}
                />
                <div className="relative flex-grow">
                  <Phone className="absolute left-3 top-2.5 text-slate-500" size={18} />
                  <input
                    type="text"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-10 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                    placeholder="7..."
                  />
                </div>
              </div>
            </div>
            <button
              onClick={handleLogin}
              disabled={isLoading || !phoneNumber}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold text-sm flex justify-center"
            >
              {isLoading ? <Loader2 className="animate-spin" size={20} /> : 'Request OTP'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <button onClick={() => setStage('INPUT_PHONE')} className="text-slate-400 text-xs flex items-center hover:text-white">
              <ArrowLeft size={14} className="mr-1" /> Back
            </button>
            <div className="flex justify-between gap-2">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => (otpRefs.current[index] = el)}
                  type="text"
                  value={digit}
                  onChange={(e) => handleOtpChange(index, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(index, e)}
                  className="w-10 h-12 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-center text-lg font-bold focus:outline-none focus:border-amber-500"
                  maxLength={1}
                />
              ))}
            </div>
            <button
              onClick={() => verifyOtp(otp.join(''))}
              disabled={isLoading || otp.includes('')}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold text-sm flex justify-center"
            >
              {isLoading ? <Loader2 className="animate-spin" size={20} /> : 'Verify'}
            </button>
            <button onClick={handleLogin} className="w-full text-slate-500 text-xs text-center hover:text-amber-500">Resend OTP</button>
          </div>
        )}
      </div>
    </div>
  );
}
