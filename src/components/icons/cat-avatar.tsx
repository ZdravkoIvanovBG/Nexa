import defaultAvatar from "@/assets/default-avatar.png";

export function CatAvatar({ className }: { className?: string }) {
  return (
    <img
      src={defaultAvatar}
      alt=""
      draggable={false}
      className={`${className ?? ""} object-cover`}
    />
  );
}
