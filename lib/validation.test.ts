import { describe, it, expect } from 'vitest'
import {
  errorOrNull,
  describeErrors,
  firstError,
  requiredString,
  maxStringLength,
  positiveNumber,
  exactArrayLength,
  latLngErrors,
} from '@/lib/validation'

describe('lib/validation', () => {
  it('errorOrNull returns null when no messages are set', () => {
    expect(errorOrNull({ a: undefined, b: undefined })).toBeNull()
  })

  it('errorOrNull returns the errors object when any message is set', () => {
    const errors = { a: 'oops', b: undefined }
    expect(errorOrNull(errors)).toEqual(errors)
  })

  it('describeErrors joins only the set messages', () => {
    expect(describeErrors({ a: 'one', b: undefined, c: 'three' })).toBe('one; three')
    expect(describeErrors({ a: undefined })).toBe('')
  })

  it('firstError returns the first non-empty message', () => {
    expect(firstError(undefined, 'second', 'third')).toBe('second')
    expect(firstError(undefined, undefined)).toBeUndefined()
  })

  it('requiredString flags empty and whitespace-only values', () => {
    expect(requiredString('', 'Name')).toBe('Name is required')
    expect(requiredString('   ', 'Name')).toBe('Name is required')
    expect(requiredString('x', 'Name')).toBeUndefined()
  })

  it('maxStringLength flags values over the limit', () => {
    expect(maxStringLength('abc', 3, 'Field')).toBeUndefined()
    expect(maxStringLength('abcd', 3, 'Field')).toBe('Field must be 3 characters or fewer')
  })

  it('positiveNumber rejects zero, negative and NaN', () => {
    expect(positiveNumber(1, 'Amount')).toBeUndefined()
    expect(positiveNumber(0, 'Amount')).toBe('Amount must be greater than zero')
    expect(positiveNumber(-5, 'Amount')).toBe('Amount must be greater than zero')
    expect(positiveNumber(Number.NaN, 'Amount')).toBe('Amount must be greater than zero')
  })

  it('exactArrayLength checks the length', () => {
    expect(exactArrayLength(new Array(32).fill(0), 32, 'Hash')).toBeUndefined()
    expect(exactArrayLength([], 32, 'Hash')).toBe('Hash must be exactly 32 bytes')
  })

  it('latLngErrors validates both coordinates and boundary values', () => {
    expect(latLngErrors(90, 180)).toEqual({})
    expect(latLngErrors(-90, -180)).toEqual({})
    expect(latLngErrors(91, 0).lat).toBeTruthy()
    expect(latLngErrors(0, 181).lng).toBeTruthy()
    expect(latLngErrors(Number.NaN, Number.NaN).lat).toBeTruthy()
  })
})
