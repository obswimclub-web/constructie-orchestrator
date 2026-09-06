import { cleanup } from "@testing-library/react";

/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectsPage } from './ProjectsPage';
import * as api from '../../data/api';
import * as hooks from '../../data/hooks';

// Mock the API and Hooks
vi.mock('../../data/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../data/api')>()),
  createProject: vi.fn(),
}));

vi.mock('../../data/hooks', () => ({
  useFetch: vi.fn(),
}));

describe('ProjectsPage Entry Flow', () => {
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

  it('New Project control opens real form and validation blocks invalid submit', async () => {
    render(<ProjectsPage />);
    
    const newBtn = screen.getByText('New Project');
    fireEvent.click(newBtn);

    expect(screen.getByText('Create New Project')).toBeDefined();

    const submitBtn = screen.getByText('Create Project');
    fireEvent.click(submitBtn);

    // Validation blocks submit
    expect(screen.getByText('Name and Repository Slug are required')).toBeDefined();
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it('valid submit calls real API client, shows loading, and triggers refresh', async () => {
    render(<ProjectsPage />);
    
    fireEvent.click(screen.getByText('New Project'));

    // Fill valid data
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'My Project' } });
    fireEvent.change(inputs[1], { target: { value: 'my/repo' } });

    (api.createProject as any).mockResolvedValueOnce({});

    const submitBtn = screen.getByText('Create Project');
    fireEvent.click(submitBtn);

    expect(api.createProject).toHaveBeenCalledWith('My Project', 'my/repo');

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalled();
    });

    // Form closes
    expect(screen.queryByText('Create New Project')).toBeNull();
  });

  it('API failure is visible', async () => {
    render(<ProjectsPage />);
    
    fireEvent.click(screen.getByText('New Project'));

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'My Project' } });
    fireEvent.change(inputs[1], { target: { value: 'my/repo' } });

    (api.createProject as any).mockRejectedValueOnce(new Error('Network error'));

    fireEvent.click(screen.getByText('Create Project'));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeDefined();
    });
    
    // Form remains open
    expect(screen.queryByText('Create New Project')).not.toBeNull();
  });

  it('cancel works', () => {
    render(<ProjectsPage />);
    fireEvent.click(screen.getByText('New Project'));
    expect(screen.getByText('Create New Project')).toBeDefined();

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Create New Project')).toBeNull();
  });
});
