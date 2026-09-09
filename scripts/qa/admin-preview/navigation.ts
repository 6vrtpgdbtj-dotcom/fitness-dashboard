export const useRouter = () => ({ refresh() {} });
export const usePathname = () => location.search.includes("users") ? "/settings/users" : "/settings/data-review";
