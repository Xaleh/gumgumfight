// Recursos do celular no PWA: service worker (/sw.js), convite para instalar na tela de
// início, tela acesa durante a partida (Wake Lock) e notificações (Web Push).

import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api';

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

// ------------------------------------------------------------------ instalação

/** Evento do Chrome/Edge/Samsung que permite abrir o pedido de instalação a partir de um botão. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// Registrado ao carregar o módulo: o evento chega logo depois de a página abrir.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Sem a mini barra do navegador: o convite é o do app (menu inicial e configurações).
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    emit();
  });
}

/** O app está aberto como aplicativo instalado (tela cheia, a partir do ícone). */
export function isStandalone(): boolean {
  return (
    (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone/iPad (o iPadOS se apresenta como Mac, mas com tela de toque). */
export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Celular ou tablet (onde o convite para instalar aparece sozinho no menu inicial). */
export const isTouchDevice = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * Como instalar aqui: `prompt` = botão que abre o pedido do navegador; `ios` = instruções
 * (Compartilhar → Adicionar à Tela de Início); `menu` = pelo menu do navegador; `installed`
 * = já está aberto como app.
 */
export type InstallMode = 'prompt' | 'ios' | 'menu' | 'installed';

function installMode(): InstallMode {
  if (isStandalone()) return 'installed';
  if (deferred) return 'prompt';
  return isIos() ? 'ios' : 'menu';
}

const subscribeInstall = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useInstallMode(): InstallMode {
  return useSyncExternalStore(subscribeInstall, installMode);
}

/** Abre o pedido de instalação do navegador. Devolve se a pessoa aceitou. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  emit();
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}

// ------------------------------------------------------------------ tela acesa

export const wakeLockSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;

/**
 * Mantém a tela acesa enquanto `active`. O navegador solta a trava quando o app vai para
 * segundo plano; ela é pedida de novo quando o app volta.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !wakeLockSupported()) return;
    let lock: WakeLockSentinel | null = null;
    let pending = false;
    let done = false;
    const acquire = async () => {
      if (done || lock || pending || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const got = await navigator.wakeLock.request('screen');
        if (done) void got.release().catch(() => undefined);
        else {
          lock = got;
          got.addEventListener('release', () => {
            if (lock === got) lock = null;
          });
        }
      } catch {
        /* recusado (bateria fraca, aba em segundo plano): tenta de novo quando voltar */
      } finally {
        pending = false;
      }
    };
    const onVisible = () => void acquire();
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      done = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
      lock = null;
    };
  }, [active]);
}

// ------------------------------------------------------------------ notificações

/** `ios-install`: no iPhone/iPad, as notificações só existem com o app instalado na tela de início. */
export type PushSupport = 'ok' | 'ios-install' | 'unsupported';

export function pushSupport(): PushSupport {
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'ok';
  return isIos() && !isStandalone() ? 'ios-install' : 'unsupported';
}

export const notificationPermission = (): NotificationPermission => ('Notification' in window ? Notification.permission : 'denied');

export interface PushPrefs {
  locale: string;
  matches: boolean;
  tournaments: boolean;
}

const keyBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Registro do service worker (com prazo: sem ele, `ready` nunca resolveria). */
async function registration(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('service worker indisponível')), 15_000)),
  ]);
}

/** Inscrição atual deste navegador (null = não inscrito ou sem suporte). */
async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  return (await registration()).pushManager.getSubscription();
}

/**
 * Inscreve este navegador (se ainda não estiver) e manda ao servidor o idioma, a conta e os
 * avisos escolhidos. Exige a permissão já concedida.
 */
export async function syncPush(serverKey: string, prefs: PushPrefs): Promise<void> {
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // Inscrição feita com outra chave do servidor (chaves trocadas): refaz.
  const key = sub?.options.applicationServerKey;
  if (sub && key && btoa(String.fromCharCode(...new Uint8Array(key))) !== btoa(String.fromCharCode(...keyBytes(serverKey)))) {
    await sub.unsubscribe().catch(() => undefined);
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(serverKey) });
  await api.push.save(sub.toJSON(), prefs);
}

/** Cancela a inscrição deste navegador (aqui e no servidor). */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  await api.push.remove(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

/**
 * Mantém a inscrição de acordo com a escolha da pessoa: ligada (e com permissão) → inscrito,
 * com idioma, conta e avisos em dia no servidor; desligada → nenhuma inscrição. Se a
 * permissão foi revogada no navegador, `onRevoked` desliga a opção.
 */
export function usePushSync(opts: { serverKey: string | null; enabled: boolean; prefs: PushPrefs; userId: string | null; onRevoked: () => void }) {
  const { serverKey, enabled, prefs, userId, onRevoked } = opts;
  useEffect(() => {
    if (!serverKey || pushSupport() !== 'ok') return;
    if (!enabled) {
      void disablePush();
      return;
    }
    if (notificationPermission() !== 'granted') {
      onRevoked();
      return;
    }
    syncPush(serverKey, prefs).catch(() => undefined);
    // `prefs` e `onRevoked` mudam de identidade a cada render: valem os campos.
  }, [serverKey, enabled, prefs.locale, prefs.matches, prefs.tournaments, userId]);
}
