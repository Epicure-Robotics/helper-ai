"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useSavingIndicator } from "@/components/hooks/useSavingIndicator";
import { SavingIndicator } from "@/components/savingIndicator";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebouncedCallback } from "@/components/useDebouncedCallback";
import { useOnChange } from "@/components/useOnChange";
import { RouterOutputs } from "@/trpc";
import { api } from "@/trpc/react";
import { SwitchSectionWrapper } from "../sectionWrapper";

const CustomerSetting = ({ mailbox }: { mailbox: RouterOutputs["mailbox"]["get"] }) => {
  const [isEnabled, setIsEnabled] = useState(mailbox.vipThreshold !== null);
  const [threshold, setThreshold] = useState(mailbox.vipThreshold?.toString() ?? "100");
  const [responseHours, setResponseHours] = useState(mailbox.vipExpectedResponseHours?.toString() ?? "");
  const savingIndicator = useSavingIndicator();
  const utils = api.useUtils();

  const { mutate: update } = api.mailbox.update.useMutation({
    onSuccess: () => {
      utils.mailbox.get.invalidate();
      savingIndicator.setState("saved");
    },
    onError: (error) => {
      savingIndicator.setState("error");
      toast.error("Error updating priority location settings", {
        description: error.message,
      });
    },
  });

  const save = useDebouncedCallback(() => {
    savingIndicator.setState("saving");
    if (isEnabled) {
      update({
        vipThreshold: Number(threshold),
        vipExpectedResponseHours: responseHours ? Number(responseHours) : null,
      });
    } else {
      update({
        vipThreshold: null,
        vipExpectedResponseHours: null,
      });
    }
  }, 500);

  useOnChange(() => {
    save();
  }, [isEnabled, threshold, responseHours]);

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<number, { name?: string; value?: string }>>({});

  const debouncedSetSearch = useDebouncedCallback((term: string) => {
    setDebouncedSearch(term);
  }, 300);

  const { data: customers, isLoading: isLoadingCustomers } = api.mailbox.customers.listAll.useQuery({
    search: debouncedSearch,
    limit: 100,
  });

  const updateCustomerMutation = api.mailbox.customers.update.useMutation({
    onSuccess: () => {
      toast.success("Location updated successfully");
      void utils.mailbox.customers.listAll.invalidate();
      setEditingCustomerId(null);
      setEditValues({});
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update location");
    },
  });

  const handleSaveCustomer = (customerId: number) => {
    const values = editValues[customerId];
    if (!values) return;

    updateCustomerMutation.mutate({
      id: customerId,
      name: values.name,
      value: values.value ? Number(values.value) * 100 : null, // Convert dollars to cents
    });
  };

  return (
    <div className="space-y-8">
      <div className="relative">
        <div className="absolute top-2 right-4 z-10">
          <SavingIndicator state={savingIndicator.state} />
        </div>
        <SwitchSectionWrapper
          title="Priority locations"
          description="Configure alerting for partner locations hosting your deployments that merit faster follow-up"
          initialSwitchChecked={isEnabled}
          onSwitchChange={setIsEnabled}
        >
          {isEnabled && (
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="max-w-2xl">
                  <Label htmlFor="vipThreshold" className="text-base font-medium">
                    VIP Priority Threshold
                  </Label>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Locations with a priority value above this threshold are flagged as VIP in the inbox
                  </p>
                  <Input
                    id="vipThreshold"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="Enter threshold value"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    className="mt-2 max-w-sm"
                  />
                </div>

                <div className="max-w-2xl">
                  <Label htmlFor="responseHours" className="text-base font-medium">
                    Response Time Target
                  </Label>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Target response window for flagged locations. You'll be alerted if replies exceed this timeframe.
                  </p>
                  <div className="mt-2 flex items-center gap-2 w-36">
                    <Input
                      id="responseHours"
                      type="number"
                      min="1"
                      step="1"
                      value={responseHours}
                      onChange={(e) => setResponseHours(e.target.value)}
                    />
                    <span className="text-sm text-muted-foreground whitespace-nowrap">hours</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </SwitchSectionWrapper>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-medium">Partner locations</h3>
          <p className="text-sm text-muted-foreground">
            Venues and partners that email about hosting placements—edit names and priority values to organize follow-up
          </p>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by email address..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              debouncedSetSearch(e.target.value);
            }}
            className="pl-9"
          />
        </div>

        <div className="border rounded-lg">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium">Contact email</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Venue name</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Priority Value</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                  <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoadingCustomers ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Loading locations...
                    </td>
                  </tr>
                ) : customers && customers.length > 0 ? (
                  customers.map((customer) => {
                    const isEditing = editingCustomerId === customer.id;
                    const editValue = editValues[customer.id];

                    return (
                      <tr key={customer.id} className="hover:bg-muted/50">
                        <td className="px-4 py-3 text-sm">{customer.email}</td>
                        <td className="px-4 py-3 text-sm">
                          {isEditing ? (
                            <Input
                              value={editValue?.name ?? customer.name ?? ""}
                              onChange={(e) =>
                                setEditValues({
                                  ...editValues,
                                  [customer.id]: {
                                    ...editValue,
                                    name: e.target.value,
                                  },
                                })
                              }
                              placeholder="Location or venue name"
                              className="h-8"
                            />
                          ) : (
                            <span className="text-muted-foreground">{customer.name || "-"}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {isEditing ? (
                            <Input
                              type="number"
                              min="0"
                              step="1"
                              value={editValue?.value ?? (customer.value ? Number(customer.value) / 100 : "")}
                              onChange={(e) =>
                                setEditValues({
                                  ...editValues,
                                  [customer.id]: {
                                    ...editValue,
                                    value: e.target.value,
                                  },
                                })
                              }
                              placeholder="0"
                              className="h-8 w-32"
                            />
                          ) : customer.value ? (
                            Number(customer.value) / 100
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">{customer.isVip && <Badge variant="bright">VIP</Badge>}</td>
                        <td className="px-4 py-3 text-sm text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleSaveCustomer(customer.id)}
                                disabled={updateCustomerMutation.isPending}
                                className="text-primary hover:underline disabled:opacity-50"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => {
                                  setEditingCustomerId(null);
                                  setEditValues({});
                                }}
                                disabled={updateCustomerMutation.isPending}
                                className="text-muted-foreground hover:underline disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingCustomerId(customer.id);
                                setEditValues({
                                  [customer.id]: {
                                    name: customer.name ?? "",
                                    value: customer.value ? (Number(customer.value) / 100).toString() : "",
                                  },
                                });
                              }}
                              className="text-primary hover:underline"
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      {searchTerm ? "No locations match your search" : "No partner locations recorded yet"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomerSetting;
