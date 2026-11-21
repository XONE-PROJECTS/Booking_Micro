/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DynamicForm } from '../DynamicForm';

describe('DynamicForm', () => {
  it('renders a labeled field', () => {
    render(
      <DynamicForm
        schema={{ fields: [{ key: 'note', type: 'text', label: 'Notes', required: true }] }}
        values={{}}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText('Notes')).toBeTruthy();
  });
});