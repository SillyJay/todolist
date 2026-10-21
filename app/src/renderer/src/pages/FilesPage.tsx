import { FolderOpen } from 'lucide-react'

/** 文件页（规格模块 6 / §9）。Phase 3 接工作区与文件预览。 */
function FilesPage(): React.JSX.Element {
  return (
    <div className="max-w-3xl">
      <div className="py-20 flex flex-col items-center text-center">
        <div className="w-10 h-10 rounded-xl bg-[#1e2432] flex items-center justify-center mb-4">
          <FolderOpen size={20} className="text-[#4f8cff]" strokeWidth={1.8} />
        </div>
        <div className="text-[14px] text-[#c8c8d4]">尚未配置工作区</div>
        <div className="text-[12px] text-[#6b6b7a] mt-2 max-w-sm leading-relaxed">
          在设置里指定一个工作区目录（如 D:\HOMEWORK），作业附件会按课程自动归档到
          「作业要求」，你自己放进去的文件会出现在「待提交」。程序只增不删。
        </div>
      </div>
    </div>
  )
}

export default FilesPage
