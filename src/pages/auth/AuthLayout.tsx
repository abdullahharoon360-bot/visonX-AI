import * as React from 'react';
import { Shield } from 'lucide-react';
import { motion } from 'motion/react';
import { firebaseProjectInfo } from '@/src/services/firebase';

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#060B16] text-slate-100 flex flex-col justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto w-full max-w-[460px] space-y-6"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600/15 border border-blue-500/30 text-cyan-400">
            <Shield className="h-5 w-5" />
          </span>
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight text-slate-100">
              VisionX AI
            </h1>
            <p className="text-xs text-slate-400">
              Intelligent Security & Identity Intelligence Platform
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/90 bg-[#0B1222] p-6 space-y-6">
          <div className="space-y-1">
            <h2 className="font-display text-lg font-semibold text-slate-100">{title}</h2>
            <p className="text-sm text-slate-400">{subtitle}</p>
          </div>
          {children}
        </div>

        <div className="text-center font-mono text-[11px] text-slate-500">
          Firebase Project {firebaseProjectInfo.projectId} · Firestore Connected
        </div>
      </motion.div>
    </div>
  );
}
