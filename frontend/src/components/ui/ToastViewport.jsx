import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

const iconMap = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: TriangleAlert,
  info: Info
};

export default function ToastViewport() {
  const notifications = useAppStore((state) => state.notifications);
  const dismissToast = useAppStore((state) => state.dismissToast);

  useEffect(() => {
    const timers = notifications.map((toast) =>
      window.setTimeout(() => dismissToast(toast.id), toast.duration || 4000)
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [notifications, dismissToast]);

  return (
    <div className="toast-viewport">
      {notifications.map((toast) => {
        const Icon = iconMap[toast.type] || Info;
        return (
          <article key={toast.id} className={`toast ${toast.type}`}>
            <Icon size={18} />
            <div>
              <strong>{toast.title}</strong>
              <p>{toast.message}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
