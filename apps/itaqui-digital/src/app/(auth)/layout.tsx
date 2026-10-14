import { Waves } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="auth-shell">
      <div className="auth-card">
        <span className="brand">
          <span className="brand-symbol">
            <Waves size={26} />
          </span>
          <span>
            itaqui<span className="brand-light">digital</span>
            <small>MAPA E OPERAÇÕES DO PORTO</small>
          </span>
        </span>
        {children}
      </div>
    </main>
  );
}
