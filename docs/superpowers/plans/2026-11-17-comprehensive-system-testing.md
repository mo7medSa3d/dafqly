# Comprehensive System Testing & Live Simulation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Overview

A thorough, end-to-end verification and simulation of all DAFQLY modules, incorporating rich historical data (overdue, partially paid, disputed, cancelled, written off), Cheques and Cheque OCR, Ledger photo AI extraction, CSV/Excel import review and commit, Customer Portal & Statements, Payments & Reconciliation, Team Tasks, and AI Copilot streaming with live OpenRouter integration.

## Tasks

- [ ] **Task 1: Seed Rich Historical & Stress Datasets**
  - [ ] Run `pnpm db:seed:rich` with `--reset` and fixed password `demo-password-123`
  - [ ] Run `pnpm db:seed:stress` with `--reset` and fixed password `demo-password-123`
  - [ ] Verify DB status and record counts across tables (`debtors`, `invoices`, `payments`, `cheques`, `promises_to_pay`, `disputes`, `collection_tasks`, `ai_action_approvals`, `statement_links`)

- [ ] **Task 2: Automated Unit and Integration Test Verification**
  - [ ] Run `pnpm test` across all packages (`core`, `providers`, `reminders`, `web`, `worker`)
  - [ ] Identify and fix any existing broken unit/integration tests or type issues
  - [ ] Confirm clean test pass across all packages

- [ ] **Task 3: Live AI Verification (Cheques OCR, Ledger AI, Copilot)**
  - [ ] Test cheque photo OCR via OpenRouter API with sample cheque image: verify bank, debtor, amount, cheque number extraction
  - [ ] Test ledger photo AI extraction via OpenRouter API: verify ledger page parsing and structured row extraction
  - [ ] Test AI Copilot streaming (`/api/ai/copilot/stream`) and multi-turn tool calling
  - [ ] Verify AI Action approval lifecycle: suggestion -> pending -> owner approval/rejection

- [ ] **Task 4: Customer Portal & Public Statement Verification**
  - [ ] Verify `/s/rich-statement-demo-2026` public statement page loads with localized invoices, receipts, and outstanding balance
  - [ ] Submit an invoice dispute from the public customer portal and verify recorded status in DB
  - [ ] Submit a promise to pay from the public customer portal and verify pending status
  - [ ] Verify payment link generation from public statement (`/api/public/statement/[token]/pay`)

- [ ] **Task 5: End-to-End Browser Functionality Simulation**
  - [ ] Authenticate with `rich@tahseel.test` and verify Dashboard rendering (aging buckets, cash projection, concentration charts)
  - [ ] Test Debtors section: search, filter, view debtor statement, toggle reminders, update details
  - [ ] Test Invoices section: create invoice, cancel invoice, record payment allocation
  - [ ] Test Cheques management: register cheque, transition status (deposited, cleared, bounced)
  - [ ] Test CSV Import: upload fixture CSV, review column mapping, commit import, verify records created, test undo
  - [ ] Test Collection Tasks: assign task to team member, filter by assignee, mark task completed
  - [ ] Test AI Inbox & Copilot drawer: ask Copilot question, verify streamed response and tool execution

- [ ] **Task 6: Playwright E2E Suite & Regression Verification**
  - [ ] Run Playwright automated browser test suite
  - [ ] Verify all core specs pass without regressions

- [ ] **Task 7: Evidence Compilation & Comprehensive Report**
  - [ ] Compile detailed summary of all test results, screenshots, and verified flows
  - [ ] Report final findings and system health to the user
