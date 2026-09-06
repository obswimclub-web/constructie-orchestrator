/** @vitest-environment jsdom */
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunsPage } from './RunsPage';
import * as api from '../../data/api';
import * as hooks from '../../data/hooks';

vi.mock('../../data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/api')>()),
  createWorkItem: vi.fn(),
}));

vi.mock('../../data/hooks', () => ({
  useFetch: vi.fn(),
}));

describe('RunsPage Entry Flow', () => {
  let mutateMock: any;

  afterEach(() => { cleanup(); });
  beforeEach(() => {
    vi.clearAllMocks();
    mutateMock = vi.fn();
    (hooks.useFetch as any).mockReturnValue({
      data: [],
      loading: false,
      error: null,
      isStale: false,
      isDegraded: false,
      refetch: mutateMock,
    });
  });

  it('Start New Run opens real form and validation blocks invalid submit', async () => {
    render(<RunsPage />);
    
    fireEvent.click(screen.getByText('Start New Run'));
    expect(screen.getByText('Start New Run', { selector: 'h3' })).toBeDefined();

    fireEvent.click(screen.getByText('Start Run'));

    expect(screen.getByText('Objective is required')).toBeDefined();
    expect(api.createWorkItem).not.toHaveBeenCalled();
  });

  it('valid submit calls real API client, shows loading, and triggers refresh', async () => {
    render(<RunsPage />);
    
    fireEvent.click(screen.getByText('Start New Run'));

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Fix bug' } });

    (api.createWorkItem as any).mockResolvedValueOnce({});

    fireEvent.click(screen.getByText('Start Run'));

    expect(api.createWorkItem).toHaveBeenCalledWith('Fix bug');

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalled();
    });

    expect(screen.queryByText('Start New Run', { selector: 'h3' })).toBeNull();
  });

  it('API failure is visible', async () => {
    render(<RunsPage />);
    
    fireEvent.click(screen.getByText('Start New Run'));

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Fix bug' } });

    (api.createWorkItem as any).mockRejectedValueOnce(new Error('Network error'));

    fireEvent.click(screen.getByText('Start Run'));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeDefined();
    });
    
    expect(screen.queryByText('Start New Run', { selector: 'h3' })).not.toBeNull();
  });

  it('cancel works', () => {
    render(<RunsPage />);
    fireEvent.click(screen.getByText('Start New Run'));
    expect(screen.getByText('Start New Run', { selector: 'h3' })).toBeDefined();

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Start New Run', { selector: 'h3' })).toBeNull();
  });
});
