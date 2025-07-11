import { useEffect, useState } from 'react'
import { SubVector } from './types';
import { getOrCreateReaction, getSubscriptionValue } from './subs';

export function useSubscription<T>(subVector: SubVector, componentName: string = 'react component'): T {
  const [val, setVal] = useState<T>(() => {
    return getSubscriptionValue(subVector)
  })
  useEffect(() => {
    const reaction = getOrCreateReaction(subVector)
    if (!reaction) return
    reaction.setComponentName(componentName)
    reaction.watch(setVal)
    return () => {
      reaction.unwatch(setVal)
    }
  }, [])
  return val
}