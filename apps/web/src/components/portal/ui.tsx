import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="portal-alert">
      {children}
    </p>
  );
}

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`portal-btn ${className ?? ''}`} {...props} />;
}

export function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="portal-field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="portal-input" {...props} />;
}

export function Stepper({ step, total }: { step: number; total: number }) {
  return (
    <ol className="portal-stepper" aria-label="Booking steps">
      {Array.from({ length: total }, (_, i) => (
        <li key={i} aria-current={i === step ? 'step' : undefined} className={i <= step ? 'active' : ''}>
          {i + 1}
        </li>
      ))}
    </ol>
  );
}