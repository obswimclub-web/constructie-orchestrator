/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import App from './App';
import { MemoryRouter } from 'react-router-dom';
import * as api from './data/api';

vi.mock('./data/api', () => ({
  loginWithBootstrap: vi.fn(),
  checkSession: vi.fn(),
  logoutOwner: vi.fn(),
  fetchProjects: vi.fn().mockResolvedValue([]),
  fetchWorkItems: vi.fn().mockResolvedValue([]),
  fetchAttempts: vi.fn().mockResolvedValue([]),
  fetchEvidence: vi.fn().mockResolvedValue([]),
  fetchApprovals: vi.fn().mockResolvedValue([]),
  fetchApproval: vi.fn().mockResolvedValue(null),
  createApproval: vi.fn(),
  decideApproval: vi.fn(),
  consumeApproval: vi.fn(),
  fetchDashboardStats: vi.fn().mockResolvedValue({
    totalProjects: 0,
    runningProjects: 0,
    healthyProjects: 0,
    degradedProjects: 0,
    openApprovals: 0,
    totalWorkItems: 0,
    activeRuns: 0,
    systemUptime: 0
  }),
  fetchAgents: vi.fn().mockResolvedValue([]),
  fetchIncidents: vi.fn().mockResolvedValue([]),
  fetchLogs: vi.fn().mockResolvedValue([]),
  fetchFindings: vi.fn().mockResolvedValue([]),
  fetchRunDetails: vi.fn().mockResolvedValue(null),
  fetchWorkspaceState: vi.fn().mockResolvedValue(null),
  fetchTaskGraph: vi.fn().mockResolvedValue([]),
  createProject: vi.fn(),
  createWorkItem: vi.fn()
}));

describe('App / LoginBootstrap', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders application when authenticated on startup', async () => {
    vi.mocked(api.checkSession).mockResolvedValue({ authenticated: true, projectBound: true });
    render(<MemoryRouter><App /></MemoryRouter>);
    
    await waitFor(() => {
      expect(screen.queryByText('Loading authentication state...')).toBeNull();
      expect(screen.queryByText('Owner Authentication')).toBeNull();
    });
  });

  it('renders LoginBootstrap overlay when unauthenticated on startup', async () => {
    vi.mocked(api.checkSession).mockResolvedValue({ authenticated: false, projectBound: false });
    render(<MemoryRouter><App /></MemoryRouter>);
    
    expect(screen.getByText('Loading authentication state...')).toBeDefined();
    expect(await screen.findByText('Owner Authentication')).toBeDefined();
  });

  it('handles login flow correctly', async () => {
    vi.mocked(api.checkSession).mockResolvedValue({ authenticated: false, projectBound: false });
    vi.mocked(api.loginWithBootstrap).mockResolvedValue();
    render(<MemoryRouter><App /></MemoryRouter>);
    
    const input = await screen.findByLabelText('Bootstrap Key');
    fireEvent.change(input, { target: { value: 'my-secret-key' } });
    
    const submit = screen.getAllByRole('button', { name: 'Authenticate' })[0];
    fireEvent.click(submit);
    
    expect(api.loginWithBootstrap).toHaveBeenCalledWith('my-secret-key');
    await waitFor(() => {
      expect(api.loginWithBootstrap).toHaveBeenCalled();
    });
  });
});
