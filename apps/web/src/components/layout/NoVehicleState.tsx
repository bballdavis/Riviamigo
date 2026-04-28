import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { EmptyState } from '@riviamigo/ui/primitives';
import { Car } from 'lucide-react';

interface NoVehicleStateProps {
  title?: string;
  description?: string;
}

export function NoVehicleState({
  title = 'No vehicle connected',
  description = 'Connect your Rivian account to start tracking telemetry.',
}: NoVehicleStateProps) {
  const navigate = useNavigate();

  return (
    <EmptyState
      icon={<Car />}
      title={title}
      description={description}
      action={{ label: 'Connect Rivian', onClick: () => navigate({ to: '/connect' }) }}
    />
  );
}