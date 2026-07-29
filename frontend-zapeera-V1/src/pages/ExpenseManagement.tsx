import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Calendar,
  Download,
  FileText,
  Filter,
  Plus,
  Receipt,
  Search,
  Tags,
  Trash2,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAdmin } from "@/contexts/useAdmin";

type ExpenseStatus = "Pending" | "Approved" | "Rejected";

interface ExpenseCategory {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

interface BusinessExpense {
  id: string;
  date: string;
  categoryId: string;
  amount: number;
  branchId: string;
  vendor: string;
  notes: string;
  receiptName: string;
  status: ExpenseStatus;
  createdAt: string;
}

const currencyFormatter = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const formatDateInput = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const thisMonthStart = () => {
  const now = new Date();
  return formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
};

const ExpenseManagement = () => {
  const { toast } = useToast();
  const { selectedCompanyId, selectedBranchId, allCompanies, allBranches } = useAdmin();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [expenses, setExpenses] = useState<BusinessExpense[]>([]);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [expenseForm, setExpenseForm] = useState({
    date: formatDateInput(new Date()),
    categoryId: "",
    amount: "",
    branchId: selectedBranchId || "all",
    vendor: "",
    notes: "",
    receiptName: "",
    status: "Pending" as ExpenseStatus,
  });
  const [filters, setFilters] = useState({
    from: thisMonthStart(),
    to: formatDateInput(new Date()),
    categoryId: "all",
    branchId: "all",
    status: "all",
    search: "",
  });

  const activeCompanyName =
    allCompanies.find((company: any) => company.id === selectedCompanyId)?.name || "Selected business";
  // Cache reading/writing disabled - expenses will load fresh from API

  useEffect(() => {
    setExpenseForm((current) => ({
      ...current,
      branchId: selectedBranchId || current.branchId || "all",
    }));
  }, [selectedBranchId]);

  useEffect(() => {
    if (!expenseForm.categoryId && categories.length > 0) {
      setExpenseForm((current) => ({ ...current, categoryId: categories[0].id }));
    }
  }, [categories, expenseForm.categoryId]);

  const branchOptions = useMemo(() => {
    if (!selectedCompanyId) return allBranches || [];
    return (allBranches || []).filter((branch: any) => {
      const branchCompanyId = branch.companyId || branch.company?.id;
      return branchCompanyId === selectedCompanyId;
    });
  }, [allBranches, selectedCompanyId]);

  const getBranchName = (branchId: string) => {
    if (branchId === "all") return "All branches";
    return branchOptions.find((branch: any) => branch.id === branchId)?.name || "Branch";
  };

  const getCategoryName = (categoryId: string) =>
    categories.find((category) => category.id === categoryId)?.name || "Uncategorized";

  const filteredExpenses = useMemo(() => {
    const searchTerm = filters.search.trim().toLowerCase();
    return expenses
      .filter((expense) => !filters.from || expense.date >= filters.from)
      .filter((expense) => !filters.to || expense.date <= filters.to)
      .filter((expense) => filters.categoryId === "all" || expense.categoryId === filters.categoryId)
      .filter((expense) => filters.branchId === "all" || expense.branchId === filters.branchId)
      .filter((expense) => filters.status === "all" || expense.status === filters.status)
      .filter((expense) => {
        if (!searchTerm) return true;
        return (
          expense.vendor.toLowerCase().includes(searchTerm) ||
          expense.notes.toLowerCase().includes(searchTerm) ||
          getCategoryName(expense.categoryId).toLowerCase().includes(searchTerm)
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, filters, categories]);

  const totals = useMemo(() => {
    const total = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);
    const pending = filteredExpenses.filter((expense) => expense.status === "Pending").length;
    const approved = filteredExpenses
      .filter((expense) => expense.status === "Approved")
      .reduce((sum, expense) => sum + expense.amount, 0);
    return { total, pending, approved };
  }, [filteredExpenses]);

  const handleAddCategory = (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = categoryName.trim();
    if (!trimmedName) {
      toast({ title: "Category name is required" });
      return;
    }

    const exists = categories.some((category) => category.name.toLowerCase() === trimmedName.toLowerCase());
    if (exists) {
      toast({ title: "Category already exists" });
      return;
    }

    const newCategory: ExpenseCategory = {
      id: `cat_${Date.now()}`,
      name: trimmedName,
      description: categoryDescription.trim(),
      createdAt: new Date().toISOString(),
    };

    setCategories((current) => [...current, newCategory]);
    setExpenseForm((current) => ({ ...current, categoryId: current.categoryId || newCategory.id }));
    setCategoryName("");
    setCategoryDescription("");
    toast({ title: "Expense category added" });
  };

  const handleAddExpense = (event: FormEvent) => {
    event.preventDefault();
    if (categories.length === 0) {
      toast({ title: "Add an expense category first" });
      return;
    }

    const amount = Number.parseFloat(expenseForm.amount);
    if (!expenseForm.categoryId || !expenseForm.date || Number.isNaN(amount) || amount <= 0) {
      toast({ title: "Date, category, and amount are required" });
      return;
    }

    const newExpense: BusinessExpense = {
      id: `exp_${Date.now()}`,
      date: expenseForm.date,
      categoryId: expenseForm.categoryId,
      amount,
      branchId: expenseForm.branchId || "all",
      vendor: expenseForm.vendor.trim(),
      notes: expenseForm.notes.trim(),
      receiptName: expenseForm.receiptName.trim(),
      status: expenseForm.status,
      createdAt: new Date().toISOString(),
    };

    setExpenses((current) => [newExpense, ...current]);
    setExpenseForm((current) => ({
      ...current,
      amount: "",
      vendor: "",
      notes: "",
      receiptName: "",
      status: "Pending",
    }));
    toast({ title: "Expense recorded" });
  };

  const handleDeleteCategory = (categoryId: string) => {
    const categoryIsUsed = expenses.some((expense) => expense.categoryId === categoryId);
    if (categoryIsUsed) {
      toast({ title: "Category is used by expenses", variant: "destructive" });
      return;
    }
    setCategories((current) => current.filter((category) => category.id !== categoryId));
    toast({ title: "Category deleted successfully" });
  };

  const handleDeleteExpense = (expenseId: string) => {
    setExpenses((current) => current.filter((expense) => expense.id !== expenseId));
    toast({ title: "Expense deleted successfully" });
  };

  const exportCsv = () => {
    const rows = [
      ["Date", "Category", "Amount", "Branch", "Vendor", "Status", "Receipt", "Notes"],
      ...filteredExpenses.map((expense) => [
        expense.date,
        getCategoryName(expense.categoryId),
        expense.amount.toString(),
        getBranchName(expense.branchId),
        expense.vendor,
        expense.status,
        expense.receiptName,
        expense.notes,
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `expenses_${formatDateInput(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 p-6 lg:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Wallet className="h-6 w-6 text-[#1a52c5]" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">Business Expense Tracker</h1>
          </div>
          <p className="max-w-3xl text-sm text-slate-600">
            {activeCompanyName} expense categories and expense entries stay scoped to this business.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={filteredExpenses.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button
            onClick={() => document.getElementById("record-expense-form")?.scrollIntoView({ behavior: "smooth" })}
            disabled={categories.length === 0}
          >
            <Plus className="mr-2 h-4 w-4" />
            Record Expense
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm font-medium text-slate-500">Filtered Expenses</p>
              <p className="mt-1 text-2xl font-bold text-slate-950">{currencyFormatter.format(totals.total)}</p>
            </div>
            <Wallet className="h-9 w-9 text-[#1a52c5]" />
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm font-medium text-slate-500">Pending Approvals</p>
              <p className="mt-1 text-2xl font-bold text-slate-950">{totals.pending}</p>
            </div>
            <Receipt className="h-9 w-9 text-[#28c2ce]" />
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm font-medium text-slate-500">Approved Total</p>
              <p className="mt-1 text-2xl font-bold text-slate-950">{currencyFormatter.format(totals.approved)}</p>
            </div>
            <FileText className="h-9 w-9 text-emerald-600" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Tags className="h-5 w-5 text-[#1a52c5]" />
              Add Expense Categories First
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <form onSubmit={handleAddCategory} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="categoryName">Category Name</Label>
                <Input
                  id="categoryName"
                  value={categoryName}
                  onChange={(event) => setCategoryName(event.target.value)}
                  placeholder="Rent, Utilities, Inventory, Salary"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="categoryDescription">Description</Label>
                <Textarea
                  id="categoryDescription"
                  value={categoryDescription}
                  onChange={(event) => setCategoryDescription(event.target.value)}
                  placeholder="What this category is used for"
                />
              </div>
              <Button type="submit" className="w-full">
                <Plus className="mr-2 h-4 w-4" />
                Add Category
              </Button>
            </form>

            <div className="space-y-2">
              {categories.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  Add at least one category before recording expenses.
                </div>
              ) : (
                categories.map((category) => (
                  <div
                    key={category.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{category.name}</p>
                      {category.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{category.description}</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteCategory(category.id)}
                      aria-label={`Delete ${category.name}`}
                    >
                      <Trash2 className="h-4 w-4 text-slate-500" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm" id="record-expense-form">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Receipt className="h-5 w-5 text-[#1a52c5]" />
              Add Expenses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddExpense} className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="expenseDate">Date</Label>
                <Input
                  id="expenseDate"
                  type="date"
                  value={expenseForm.date}
                  disabled={categories.length === 0}
                  onChange={(event) => setExpenseForm((current) => ({ ...current, date: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={expenseForm.categoryId}
                  disabled={categories.length === 0}
                  onValueChange={(value) => setExpenseForm((current) => ({ ...current, categoryId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="expenseAmount">Amount</Label>
                <Input
                  id="expenseAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={expenseForm.amount}
                  disabled={categories.length === 0}
                  onChange={(event) => setExpenseForm((current) => ({ ...current, amount: event.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>Branch</Label>
                <Select
                  value={expenseForm.branchId}
                  disabled={categories.length === 0}
                  onValueChange={(value) => setExpenseForm((current) => ({ ...current, branchId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select branch" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All branches</SelectItem>
                    {branchOptions.map((branch: any) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="expenseVendor">Vendor or Payee</Label>
                <Input
                  id="expenseVendor"
                  value={expenseForm.vendor}
                  disabled={categories.length === 0}
                  onChange={(event) => setExpenseForm((current) => ({ ...current, vendor: event.target.value }))}
                  placeholder="Landlord, supplier, staff"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={expenseForm.status}
                  disabled={categories.length === 0}
                  onValueChange={(value: ExpenseStatus) => setExpenseForm((current) => ({ ...current, status: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="Approved">Approved</SelectItem>
                    <SelectItem value="Rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="expenseReceipt">Receipt Reference</Label>
                <Input
                  id="expenseReceipt"
                  value={expenseForm.receiptName}
                  disabled={categories.length === 0}
                  onChange={(event) => setExpenseForm((current) => ({ ...current, receiptName: event.target.value }))}
                  placeholder="Receipt number or file name"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="expenseNotes">Notes</Label>
                <Textarea
                  id="expenseNotes"
                  value={expenseForm.notes}
                  disabled={categories.length === 0}
                  onChange={(event) => setExpenseForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Add internal expense notes"
                />
              </div>
              <div className="md:col-span-2">
                <Button type="submit" disabled={categories.length === 0} className="w-full md:w-auto">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Expense
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Filter className="h-5 w-5 text-[#1a52c5]" />
              Expenses
            </CardTitle>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[140px_140px_170px_170px_150px_220px]">
              <Input
                type="date"
                value={filters.from}
                onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
              />
              <Input
                type="date"
                value={filters.to}
                onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
              />
              <Select
                value={filters.categoryId}
                onValueChange={(value) => setFilters((current) => ({ ...current, categoryId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.branchId}
                onValueChange={(value) => setFilters((current) => ({ ...current, branchId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Branch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All branches</SelectItem>
                  {branchOptions.map((branch: any) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.status}
                onValueChange={(value) => setFilters((current) => ({ ...current, status: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Approved">Approved</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={filters.search}
                  onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                  placeholder="Search expenses"
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead className="w-[56px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredExpenses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-28 text-center text-slate-500">
                    No expenses match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filteredExpenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-slate-400" />
                        {expense.date}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium text-slate-900">{getCategoryName(expense.categoryId)}</TableCell>
                    <TableCell className="font-semibold text-slate-950">
                      {currencyFormatter.format(expense.amount)}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-slate-400" />
                        {getBranchName(expense.branchId)}
                      </span>
                    </TableCell>
                    <TableCell>{expense.vendor || "-"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          expense.status === "Approved"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : expense.status === "Rejected"
                              ? "border-red-200 bg-red-50 text-red-700"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                        }
                      >
                        {expense.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{expense.receiptName || "-"}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteExpense(expense.id)}
                        aria-label="Delete expense"
                      >
                        <Trash2 className="h-4 w-4 text-slate-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default ExpenseManagement;
