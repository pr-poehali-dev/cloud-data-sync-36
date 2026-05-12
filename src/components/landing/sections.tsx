import { Badge } from "@/components/ui/badge"

export const sections = [
  {
    id: 'hero',
    subtitle: <Badge variant="outline" className="text-white border-white">Набор открыт</Badge>,
    title: "Время строить будущее.",
    showButton: true,
    buttonText: 'Присоединиться'
  },
  {
    id: 'about',
    title: 'Почему мы?',
    content: 'Мы предоставляем ресурсы, менторство и поддерживающее сообщество для развития ваших проектов.'
  },
  {
    id: 'features',
    title: 'Что мы предлагаем',
    content: 'Доступ к экспертным консультациям, нетворкингу и современным инструментам для ускорения вашего роста.'
  },
  {
    id: 'testimonials',
    title: 'Истории успеха',
    content: 'Узнайте, как участники сообщества превратили свои идеи в успешные проекты.'
  },
  {
    id: 'join',
    title: 'Начните сейчас',
    content: 'Готовы вывести свой проект на новый уровень? Присоединяйтесь к нашему сообществу и начните строить своё будущее.',
    showButton: true,
    buttonText: 'Начать'
  },
]
