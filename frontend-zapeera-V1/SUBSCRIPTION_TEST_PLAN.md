# Subscription Upgrade Test Plan

## Test Environment Setup
- Backend running on `http://localhost:4100/api`
- Frontend running on dev server
- Test user with OWNER role
- Test business with no active subscription (or trial)

## Test Cases

### 1. Pricing Plans Display
**Objective:** Verify pricing plans display correctly with single-business restriction

**Steps:**
1. Navigate to `/zapeera/subscription` page
2. Verify that "Single Branch" and "Multi Branch" tabs are NOT visible (segment tabs hidden)
3. Verify all pricing plans are displayed (Trial, Starter, Growth, Scale)
4. Check that plan features do NOT mention "unlimited businesses"
5. Verify Growth plan shows "3 branches, 3 counters per branch included" (not unlimited businesses)
6. Verify Scale plan shows "10 branches, unlimited counters included" (not unlimited businesses)

**Expected Result:**
- No segment tabs visible
- All plans shown with single-business restrictions
- No mention of unlimited businesses in features

---

### 2. Card Payment Flow
**Objective:** Test card payment option in upgrade flow

**Steps:**
1. Navigate to `/zapeera/subscription` page
2. Click "Get Plan" or "Upgrade Plan" button
3. Select a plan (e.g., Growth)
4. Click "Continue Setup"
5. Configure branches/counters if needed
6. Click "Review & Pay"
7. Verify "Card Payment" radio button is selected by default
8. Verify card input fields are visible (Card Number, Expiry Date, CVC)
9. Click "Manual Payment" radio button
10. Verify card input fields are hidden
11. Click "Card Payment" radio button
12. Verify card input fields are visible again

**Expected Result:**
- Card Payment selected by default
- Card fields shown when Card Payment selected
- Card fields hidden when Manual Payment selected
- Manual payment form shown when Manual Payment selected

---

### 3. Manual Payment Flow
**Objective:** Test manual payment option with receipt upload

**Steps:**
1. Navigate to `/zapeera/subscription` page
2. Click "Get Plan" or "Upgrade Plan" button
3. Select a plan (e.g., Starter)
4. Click "Continue Setup"
5. Click "Review & Pay"
6. Select "Manual Payment" radio button
7. Verify PaymentReceiptUpload component is displayed
8. Verify payment method options: Bank Transfer, JazzCash, EasyPaisa
9. Select a payment method (e.g., JazzCash)
10. Verify plan dropdown is available and shows correct plans
11. Select the plan you're paying for
12. Verify amount field auto-fills with plan price
13. Try to submit without receipt - should show error
14. Upload a receipt image (PNG/JPG/WEBP/PDF)
15. Fill in transaction ID/reference (optional)
16. Click "Submit Receipt for Review"
17. Verify success message appears
18. Verify submission history shows the new entry with "Pending Review" status

**Expected Result:**
- Manual payment form displayed correctly
- Payment methods shown: Bank Transfer, JazzCash, EasyPaisa
- Plan dropdown populated correctly
- Amount auto-fills with selected plan price
- Receipt upload works
- Success message shown after submission
- Submission history updated

---

### 4. Payment Receipt Upload Validation
**Objective:** Test receipt upload validation

**Steps:**
1. In Manual Payment form, try to submit without selecting a plan
   - Expected: Error "Select the plan you paid for"
2. Try to submit without selecting payment method
   - Expected: Error "Select your payment method"
3. Try to submit without amount
   - Expected: Error "Enter a valid payment amount"
4. Enter amount that differs by more than 5% from plan price
   - Expected: Error "Amount must be within ±5% of plan price"
5. Upload a receipt and submit with valid data
   - Expected: Success message

**Expected Result:**
- All validation errors display correctly
- Valid submission succeeds

---

### 5. Pending Payment State
**Objective:** Test UI when payment proof is pending review

**Steps:**
1. Submit a manual payment receipt
2. After submission, verify the UI shows "Waiting for Admin Approval" state
3. Verify it shows plan name, amount, payment method
4. Verify "Refresh" button is available
5. Try to submit another receipt
   - Expected: Should show error "You already have a proof under review"

**Expected Result:**
- Pending state displayed correctly
- Cannot submit another receipt while one is pending

---

### 6. Rejected Payment State
**Objective:** Test UI when payment proof is rejected

**Steps:**
1. (Simulate rejection via backend or admin panel)
2. Verify UI shows "Previous submission was rejected"
3. Verify rejection reason is displayed
4. Verify user can submit a new receipt
5. Submit a new receipt with corrected details
6. Verify it shows as pending again

**Expected Result:**
- Rejection state displayed with reason
- User can resubmit after rejection

---

### 7. Endpoint Verification
**Objective:** Verify payment receipts are sent to correct endpoint

**Steps:**
1. Open browser DevTools (Network tab)
2. Submit a manual payment receipt
3. Verify the request goes to `http://localhost:4100/api/payments/manual/submit`
4. Verify the request includes:
   - screenshot (file)
   - businessId
   - planId
   - amount
   - method
   - referenceNote (if provided)
5. Verify the response includes success: true

**Expected Result:**
- Correct endpoint called
- All required fields sent
- Success response received

---

### 8. Subscription Activation After Approval
**Objective:** Test that subscription activates after manual payment approval

**Steps:**
1. Submit manual payment receipt
2. (Via backend/admin panel) Approve the payment proof
3. Refresh the subscription page
4. Verify subscription status changes to "ACTIVE"
5. Verify current plan shows the upgraded plan
6. Verify usage limits are updated based on new plan

**Expected Result:**
- Subscription activates after approval
- Plan and limits updated correctly

---

### 9. Cross-User Testing
**Objective:** Test upgrade process for different user roles

**Test as OWNER:**
- Full access to upgrade flow
- Can see all plans
- Can submit manual payments

**Test as MANAGER:**
- May have restricted access
- Verify appropriate permissions

**Test as CASHIER:**
- May have restricted access
- Verify appropriate permissions

**Expected Result:**
- Each role sees appropriate upgrade options based on permissions

---

### 10. Edge Cases
**Objective:** Test edge cases and error handling

**Test Cases:**
1. Try to upgrade with no business selected
2. Try to upgrade with expired session
3. Submit receipt with very large file (>5MB)
4. Submit receipt with invalid file type
5. Network error during submission
6. Backend returns error response

**Expected Result:**
- Appropriate error messages displayed
- Graceful error handling

---

## Test Checklist

### Pricing Plans
- [ ] No segment tabs (Single Branch/Multi Branch) visible
- [ ] All 4 plans displayed (Trial, Starter, Growth, Scale)
- [ ] No "unlimited businesses" mentions in features
- [ ] Growth plan: "3 branches, 3 counters per branch included"
- [ ] Scale plan: "10 branches, unlimited counters included"

### Card Payment
- [ ] Card Payment selected by default
- [ ] Card fields visible when Card Payment selected
- [ ] Card fields hidden when Manual Payment selected

### Manual Payment
- [ ] Manual Payment option available
- [ ] Payment methods: Bank Transfer, JazzCash, EasyPaisa
- [ ] Plan dropdown populated correctly
- [ ] Amount auto-fills with plan price
- [ ] Receipt upload works
- [ ] Validation errors display correctly
- [ ] Success message after submission
- [ ] Submission history updates

### Pending State
- [ ] "Waiting for Admin Approval" displayed
- [ ] Plan name, amount, method shown
- [ ] Cannot submit while pending

### Rejected State
- [ ] Rejection reason displayed
- [ ] Can resubmit after rejection

### Endpoint
- [ ] Requests go to `http://localhost:4100/api/payments/manual/submit`
- [ ] All required fields sent
- [ ] Success response received

### Post-Approval
- [ ] Subscription activates after approval
- [ ] Plan and limits updated

### Cross-User
- [ ] OWNER can upgrade
- [ ] MANAGER permissions checked
- [ ] CASHIER permissions checked

## Notes
- Manual payment approval requires backend/admin panel action
- Test with different browsers (Chrome, Firefox, Safari)
- Test on mobile devices if applicable
- Check console for any errors during testing
