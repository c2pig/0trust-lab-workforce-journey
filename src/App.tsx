import { LabLeaseGuard } from './shell';
import { WorkforceLabPage } from './pages/WorkforceLabPage';

export default function App() {
  return (
    <LabLeaseGuard labSlug="workforce-journey" labTitle="Workforce Identity Lifecycle">
      <WorkforceLabPage
        onBackHome={() => {
          window.location.href =
            window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
              ? 'http://localhost:5173/'
              : 'https://0trust.dev/';
        }}
      />
    </LabLeaseGuard>
  );
}
