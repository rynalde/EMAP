import { AccountMenu } from "@/components/account-menu";
import { PortDashboard } from "@/components/port-dashboard";
export default function Page() {
  return <PortDashboard account={<AccountMenu />} />;
}
