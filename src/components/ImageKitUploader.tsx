import React, { useRef } from 'react';
import { IKContext, IKUpload } from 'imagekitio-react';
import { Loader2 } from 'lucide-react';

interface Props {
  folder: string;
  onUploadSuccess: (url: string) => void;
  onUploadError: (err: any) => void;
}

export default function ImageKitUploader({ folder, onUploadSuccess, onUploadError }: Props) {
  const ikUploadRef = useRef(null);

  const authenticator = async () => {
    try {
      const response = await fetch('/api/imagekit/auth');
      if (!response.ok) throw new Error('Auth request failed');
      return await response.json();
    } catch (error) {
      throw new Error('ImageKit authentication failed');
    }
  };

  return (
    <IKContext
      publicKey={import.meta.env.VITE_IMAGEKIT_PUBLIC_KEY}
      urlEndpoint={import.meta.env.VITE_IMAGEKIT_URL_ENDPOINT}
      authenticator={authenticator}
    >
      <IKUpload
        folder={folder}
        ref={ikUploadRef}
        onError={(err) => onUploadError(err)}
        onSuccess={(res) => onUploadSuccess(res.url)}
        className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-amber-500 file:text-slate-900 hover:file:bg-amber-600 cursor-pointer"
      />
    </IKContext>
  );
}
