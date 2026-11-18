import * as sdk from '../client/generated/sdk.gen'
import type { MonthlyReviewIn } from '../client/generated/types.gen'

export const reviewApi = {
  read: (month: string) => sdk.getMonthlyReviewApiMonthlyReviewsMonthGet({ month }),
  save: (month: string, requestBody: MonthlyReviewIn) => sdk.putMonthlyReviewApiMonthlyReviewsMonthPut({ month, requestBody }),
  clear: (month: string, requestBody: MonthlyReviewIn) => sdk.clearMonthlyReviewApiMonthlyReviewsMonthClearPost({ month, requestBody }),
}
