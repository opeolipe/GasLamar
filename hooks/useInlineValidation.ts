import { useState, useRef } from 'react';

export function useInlineValidation<T>({
  value,
  validate,
}: {
  value: T;
  validate: (value: T) => string | null;
}) {
  const [touched, setTouched] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onBlur() {
    setTouched(true);
    setError(validate(value));
  }

  function onChange(next: T) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (touched) setError(validate(next));
    }, 400);
  }

  return { touched, error, onBlur, onChange, isValid: !error && touched };
}
